// QueueWorker: the pgmq consumer loop (ADR-007, 04.architecture.md "Queue design").
//
// One loop per registered queue. Each tick reads up to `batchSize` messages
// with the queue's visibility timeout and runs them through a semaphore shared
// by all queues (`MT_WORKER_CONCURRENCY`). For each message:
//
//   parse payload ─ invalid ─▶ archive, log (no attempt row: no trusted tenant)
//        │
//   resolve handler ─ none ─▶ archive, log
//        │
//   run ─▶ ok    ─▶ attempt `ok`, archive
//        ─▶ retry ─▶ attempt `transient_error`; next delay from core
//                    `decideAfterFailure`: re-send with attempt + 1 and archive,
//                    or after the sixth attempt call `onExhausted` and archive
//        ─▶ fail  ─▶ attempt `permanent_error`, archive
//        ─▶ throw ─▶ treated as retry `internal_error`
//
// A crash between read and complete leaves the message invisible until the
// visibility timeout; then it runs again. Handlers are idempotent, except the
// WhatsApp send, which claims its message row before the call (ADR-017).

import { decideAfterFailure } from "@mt/core";
import type { QueueMessage, QueueName } from "@mt/db";

import type { HandlerRegistry } from "./registry";
import type { AttemptRecord, JobContext, JobOutcome, Logger, QueueClient } from "./types";

export interface QueueWorkerOptions {
  readonly client: QueueClient;
  readonly registry: HandlerRegistry;
  readonly log: Logger;
  /** Jobs running at once across all queues. Default 4. */
  readonly concurrency?: number;
  /** Messages per read. Default: the concurrency. */
  readonly batchSize?: number;
  /** Pause after an empty read. Default 1000 ms. */
  readonly idleDelayMs?: number;
  /** Pause after a failed read (database down). Default 5000 ms. */
  readonly errorDelayMs?: number;
}

export interface WorkerHealth {
  readonly status: "ok" | "stopping" | "stopped" | "idle";
  readonly queues: readonly QueueName[];
  readonly inFlight: number;
  readonly processed: number;
  readonly failed: number;
  readonly lastTickAt: string | null;
}

class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(private readonly limit: number) {}
  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
  }
  release(): void {
    this.active--;
    this.waiting.shift()?.();
  }
}

export class QueueWorker {
  private readonly client: QueueClient;
  private readonly registry: HandlerRegistry;
  private readonly log: Logger;
  private readonly batchSize: number;
  private readonly idleDelayMs: number;
  private readonly errorDelayMs: number;
  private readonly slots: Semaphore;
  private readonly abort = new AbortController();
  private readonly inFlight = new Set<Promise<void>>();
  private loops: Promise<void>[] = [];
  private state: WorkerHealth["status"] = "idle";
  private processed = 0;
  private failed = 0;
  private lastTickAt: Date | null = null;

  constructor(options: QueueWorkerOptions) {
    const concurrency = Math.max(1, options.concurrency ?? 4);
    this.client = options.client;
    this.registry = options.registry;
    this.log = options.log;
    this.batchSize = Math.max(1, options.batchSize ?? concurrency);
    this.idleDelayMs = options.idleDelayMs ?? 1000;
    this.errorDelayMs = options.errorDelayMs ?? 5000;
    this.slots = new Semaphore(concurrency);
  }

  start(): void {
    if (this.state === "ok") return;
    this.state = "ok";
    this.loops = this.registry.queues().map((queue) => this.loop(queue));
    this.log.info("worker started", { queues: this.registry.queues() });
  }

  /** Graceful shutdown: no new reads, wait for running jobs. */
  async stop(): Promise<void> {
    if (this.state === "stopped") return;
    this.state = "stopping";
    this.abort.abort();
    await Promise.all(this.loops);
    await Promise.all([...this.inFlight]);
    this.state = "stopped";
    this.log.info("worker stopped", { processed: this.processed });
  }

  health(): WorkerHealth {
    return {
      status: this.state,
      queues: this.registry.queues(),
      inFlight: this.inFlight.size,
      processed: this.processed,
      failed: this.failed,
      lastTickAt: this.lastTickAt?.toISOString() ?? null,
    };
  }

  private async loop(queue: QueueName): Promise<void> {
    while (this.state === "ok") {
      let count = 0;
      try {
        count = await this.tick(queue);
      } catch (error) {
        this.log.error("queue read failed", { queue, error: (error as Error).message });
        await this.pause(this.errorDelayMs);
        continue;
      }
      if (count === 0) await this.pause(this.idleDelayMs);
    }
  }

  private pause(ms: number): Promise<void> {
    if (this.abort.signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.abort.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  /** One read and the processing of what it returned. Returns the number of messages read. */
  async tick(queue: QueueName): Promise<number> {
    this.lastTickAt = new Date();
    const messages = await this.client.read(queue, this.registry.visibilityTimeoutSeconds(queue), this.batchSize);
    const runs = messages.map(async (m) => {
      await this.slots.acquire();
      const run = this.process(queue, m).finally(() => this.slots.release());
      this.inFlight.add(run);
      try {
        await run;
      } finally {
        this.inFlight.delete(run);
      }
    });
    await Promise.all(runs);
    return messages.length;
  }

  private async process(queue: QueueName, m: QueueMessage<unknown>): Promise<void> {
    const handler = this.registry.resolve(queue, m.message);
    if (!handler) {
      this.log.error("no handler for message; archived", { queue, msgId: m.msgId });
      await this.client.complete({ queue, msgId: m.msgId, attempt: null });
      return;
    }
    const parsed = handler.schema.safeParse(m.message);
    if (!parsed.success) {
      this.log.error("invalid payload; archived", { queue, msgId: m.msgId, handler: handler.name });
      await this.client.complete({ queue, msgId: m.msgId, attempt: null });
      return;
    }
    const payload = parsed.data;
    const ctx: JobContext<typeof payload> = {
      queue,
      msgId: m.msgId,
      payload,
      attempt: payload.attempt ?? 1,
      readCount: m.readCount,
      signal: this.abort.signal,
    };

    const started = performance.now();
    let outcome: JobOutcome;
    try {
      outcome = await handler.run(ctx);
    } catch (error) {
      this.log.error("handler threw", {
        queue,
        msgId: m.msgId,
        handler: handler.name,
        error: (error as Error).message,
      });
      outcome = { kind: "retry", errorCode: "internal_error" };
    }
    const durationMs = Math.max(0, Math.round(performance.now() - started));
    this.processed++;

    const attempt = (o: AttemptRecord["outcome"], errorCode: string | null, httpStatus?: number): AttemptRecord => ({
      restaurantId: payload.restaurantId,
      subjectType: handler.subjectType,
      subjectId: handler.subjectId(payload),
      attemptNo: ctx.attempt,
      outcome: o,
      httpStatus: httpStatus ?? null,
      errorCode,
      durationMs,
    });

    if (outcome.kind === "ok") {
      await this.client.complete({ queue, msgId: m.msgId, attempt: attempt("ok", null, outcome.httpStatus) });
      return;
    }
    if (outcome.kind === "fail") {
      this.failed++;
      this.log.warn("job failed", { queue, msgId: m.msgId, handler: handler.name, errorCode: outcome.errorCode });
      await this.client.complete({
        queue,
        msgId: m.msgId,
        attempt: attempt("permanent_error", outcome.errorCode, outcome.httpStatus),
      });
      return;
    }

    const decision = decideAfterFailure({
      attemptNo: ctx.attempt,
      failure: "transient",
      ...(outcome.retryAfterMs !== undefined ? { retryAfterMs: outcome.retryAfterMs } : {}),
    });
    const record = attempt("transient_error", outcome.errorCode, outcome.httpStatus);
    if (decision.action === "retry") {
      await this.client.complete({
        queue,
        msgId: m.msgId,
        attempt: record,
        retry: { payload: { ...payload, attempt: ctx.attempt + 1 }, delaySeconds: Math.ceil(decision.delayMs / 1000) },
      });
      return;
    }
    this.failed++;
    this.log.warn("job exhausted", { queue, msgId: m.msgId, handler: handler.name, errorCode: outcome.errorCode });
    try {
      await handler.onExhausted?.(ctx, { errorCode: outcome.errorCode });
    } catch (error) {
      this.log.error("onExhausted threw", { queue, msgId: m.msgId, error: (error as Error).message });
    }
    await this.client.complete({ queue, msgId: m.msgId, attempt: record });
  }
}
