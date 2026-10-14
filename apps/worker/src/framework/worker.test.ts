// covers FR-108, NFR-022, NFR-032, ADR-007 (poll loop, visibility timeout, retries, job_attempts, archive)
import { describe, expect, test } from "bun:test";
import { MAX_ATTEMPTS, RETRY_DELAYS_MS } from "@mt/core";
import { QUEUES } from "@mt/db";
import { z } from "zod";

import { MemoryQueue } from "./memory-queue";
import { HandlerRegistry } from "./registry";
import type { JobHandler, JobOutcome } from "./types";
import { QueueWorker } from "./worker";

const R = "3f6c1a0e-7a3b-4b1e-9c53-1f3f6d0f6a11";
const S = "0d9e2b34-5c11-4e7a-8d2f-6a5b9c0e1f22";

const syncSchema = z.object({
  v: z.literal(1),
  restaurantId: z.string().uuid(),
  op: z.literal("whatsapp_reconcile"),
  attempt: z.number().int().optional(),
});
type SyncPayload = z.infer<typeof syncSchema>;

function syncHandler(run: () => Promise<JobOutcome>, extra: Partial<JobHandler<SyncPayload>> = {}) {
  const exhausted: string[] = [];
  const handler: JobHandler<SyncPayload> = {
    name: "test.sync",
    queue: QUEUES.sync,
    op: "whatsapp_reconcile",
    schema: syncSchema,
    subjectType: "sync",
    subjectId: () => null,
    run,
    onExhausted: async (_ctx, last) => {
      exhausted.push(last.errorCode);
    },
    ...extra,
  };
  return { handler, exhausted };
}

const quietLog = { info: () => {}, warn: () => {}, error: () => {} };

function setup(handler: JobHandler<SyncPayload>, opts: { concurrency?: number } = {}) {
  const queue = new MemoryQueue();
  const registry = new HandlerRegistry().register(handler);
  const worker = new QueueWorker({ client: queue, registry, log: quietLog, concurrency: opts.concurrency ?? 4 });
  return { queue, worker };
}

const job = (extra: Record<string, unknown> = {}) => ({ v: 1, restaurantId: R, op: "whatsapp_reconcile", ...extra });

describe("HandlerRegistry", () => {
  test("resolves a handler by queue and payload op", () => {
    const { handler } = syncHandler(async () => ({ kind: "ok" }));
    const registry = new HandlerRegistry().register(handler);
    expect(registry.resolve(QUEUES.sync, job())).toBe(handler);
    expect(registry.resolve(QUEUES.sync, { ...job(), op: "other" })).toBeUndefined();
    expect(registry.queues()).toEqual([QUEUES.sync]);
  });

  test("a handler without op serves every payload of its queue", () => {
    const { handler } = syncHandler(async () => ({ kind: "ok" }), { op: undefined });
    const registry = new HandlerRegistry().register(handler);
    expect(registry.resolve(QUEUES.sync, { anything: true })).toBe(handler);
  });

  test("two handlers for the same queue and op are refused", () => {
    const { handler } = syncHandler(async () => ({ kind: "ok" }));
    const registry = new HandlerRegistry().register(handler);
    expect(() => registry.register(handler)).toThrow(/already/);
  });

  test("the queue visibility timeout is the largest handler timeout, at least 60 s", () => {
    const { handler } = syncHandler(async () => ({ kind: "ok" }), { visibilityTimeoutSeconds: 300 });
    const registry = new HandlerRegistry().register(handler);
    expect(registry.visibilityTimeoutSeconds(QUEUES.sync)).toBe(300);
    const plain = new HandlerRegistry().register(syncHandler(async () => ({ kind: "ok" })).handler);
    expect(plain.visibilityTimeoutSeconds(QUEUES.sync)).toBe(60);
  });
});

describe("QueueWorker.tick", () => {
  test("a successful job writes one ok attempt and is archived", async () => {
    const { handler } = syncHandler(async () => ({ kind: "ok" }));
    const { queue, worker } = setup(handler);
    queue.send(QUEUES.sync, job());
    expect(await worker.tick(QUEUES.sync)).toBe(1);
    expect(queue.attempts).toHaveLength(1);
    expect(queue.attempts[0]).toMatchObject({ restaurantId: R, subjectType: "sync", attemptNo: 1, outcome: "ok" });
    expect(queue.pending(QUEUES.sync)).toHaveLength(0);
    expect(queue.archived).toHaveLength(1);
  });

  test("the handler sees the attempt number and the pgmq read count", async () => {
    const seen: { attempt: number; readCount: number }[] = [];
    const { handler } = syncHandler(async () => ({ kind: "ok" }));
    const spy: JobHandler<SyncPayload> = {
      ...handler,
      run: async (ctx) => {
        seen.push({ attempt: ctx.attempt, readCount: ctx.readCount });
        return { kind: "ok" };
      },
    };
    const { queue, worker } = setup(spy);
    queue.send(QUEUES.sync, job({ attempt: 3 }));
    await worker.tick(QUEUES.sync);
    expect(seen).toEqual([{ attempt: 3, readCount: 1 }]);
  });

  test("a transient failure re-sends the job with attempt + 1 and the 1 minute delay", async () => {
    const { handler } = syncHandler(async () => ({ kind: "retry", errorCode: "upstream_error", httpStatus: 503 }));
    const { queue, worker } = setup(handler);
    queue.send(QUEUES.sync, job());
    await worker.tick(QUEUES.sync);
    expect(queue.attempts[0]).toMatchObject({
      outcome: "transient_error",
      errorCode: "upstream_error",
      httpStatus: 503,
    });
    expect(queue.sent).toEqual([{ queue: QUEUES.sync, message: job({ attempt: 2 }), delaySeconds: 60 }]);
    // The re-sent job is invisible until the delay passes.
    expect(await worker.tick(QUEUES.sync)).toBe(0);
  });

  test("Retry-After lengthens the delay", async () => {
    const { handler } = syncHandler(async () => ({ kind: "retry", errorCode: "rate_limited", retryAfterMs: 600_000 }));
    const { queue, worker } = setup(handler);
    queue.send(QUEUES.sync, job());
    await worker.tick(QUEUES.sync);
    expect(queue.sent[0]?.delaySeconds).toBe(600);
  });

  test("a job that always fails runs six attempts on 1m/5m/30m/2h/8h, then onExhausted once (FR-108)", async () => {
    const { handler, exhausted } = syncHandler(async () => ({ kind: "retry", errorCode: "connection_error" }));
    const { queue, worker } = setup(handler);
    queue.send(QUEUES.sync, job());
    for (let i = 0; i < 10; i++) {
      await worker.tick(QUEUES.sync);
      queue.now += 9 * 3600_000;
    }
    expect(queue.attempts.map((a) => a.attemptNo)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(queue.attempts).toHaveLength(MAX_ATTEMPTS);
    expect(queue.sent.map((s) => s.delaySeconds * 1000)).toEqual([...RETRY_DELAYS_MS]);
    expect(exhausted).toEqual(["connection_error"]);
    expect(queue.pending(QUEUES.sync)).toHaveLength(0);
  });

  test("a permanent or ambiguous failure stops at once: one attempt, no re-send", async () => {
    const { handler, exhausted } = syncHandler(async () => ({ kind: "fail", errorCode: "ambiguous" }));
    const { queue, worker } = setup(handler);
    queue.send(QUEUES.sync, job());
    await worker.tick(QUEUES.sync);
    expect(queue.attempts).toHaveLength(1);
    expect(queue.attempts[0]).toMatchObject({ outcome: "permanent_error", errorCode: "ambiguous" });
    expect(queue.sent).toHaveLength(0);
    expect(exhausted).toEqual([]);
  });

  test("an exception from the handler is a transient internal_error", async () => {
    const { handler } = syncHandler(async () => {
      throw new Error("db down");
    });
    const { queue, worker } = setup(handler);
    queue.send(QUEUES.sync, job());
    await worker.tick(QUEUES.sync);
    expect(queue.attempts[0]).toMatchObject({ outcome: "transient_error", errorCode: "internal_error" });
    expect(queue.sent).toHaveLength(1);
  });

  test("an invalid payload is archived without an attempt row", async () => {
    let ran = false;
    const { handler } = syncHandler(async () => {
      ran = true;
      return { kind: "ok" };
    });
    const { queue, worker } = setup(handler);
    queue.send(QUEUES.sync, { v: 1, restaurantId: "not-a-uuid", op: "whatsapp_reconcile" });
    await worker.tick(QUEUES.sync);
    expect(ran).toBe(false);
    expect(queue.attempts).toHaveLength(0);
    expect(queue.archived).toHaveLength(1);
  });

  test("a payload with no matching handler is archived without running anything", async () => {
    const { handler } = syncHandler(async () => ({ kind: "ok" }));
    const { queue, worker } = setup(handler);
    queue.send(QUEUES.sync, { ...job(), op: "unknown_op" });
    await worker.tick(QUEUES.sync);
    expect(queue.archived).toHaveLength(1);
    expect(queue.attempts).toHaveLength(0);
  });

  test("the subject id comes from the handler", async () => {
    const { handler } = syncHandler(async () => ({ kind: "ok" }), { subjectId: () => S });
    const { queue, worker } = setup(handler);
    queue.send(QUEUES.sync, job());
    await worker.tick(QUEUES.sync);
    expect(queue.attempts[0]?.subjectId).toBe(S);
  });

  test("a batch runs at most `concurrency` jobs at once", async () => {
    let running = 0;
    let peak = 0;
    const { handler } = syncHandler(async () => {
      running++;
      peak = Math.max(peak, running);
      await Bun.sleep(20);
      running--;
      return { kind: "ok" };
    });
    const { queue, worker } = setup(handler, { concurrency: 2 });
    for (let i = 0; i < 5; i++) queue.send(QUEUES.sync, job());
    let done = 0;
    while (done < 5) done += await worker.tick(QUEUES.sync);
    expect(peak).toBe(2);
    expect(queue.attempts).toHaveLength(5);
  });

  test("a message read but not completed comes back after the visibility timeout", async () => {
    const queue = new MemoryQueue();
    queue.send(QUEUES.sync, job());
    expect(await queue.read(QUEUES.sync, 60, 1)).toHaveLength(1);
    expect(await queue.read(QUEUES.sync, 60, 1)).toHaveLength(0);
    queue.now += 61_000;
    const again = await queue.read(QUEUES.sync, 60, 1);
    expect(again[0]?.readCount).toBe(2);
  });
});

describe("QueueWorker lifecycle", () => {
  test("stop() waits for in-flight jobs and then the loop ends", async () => {
    let finished = false;
    const { handler } = syncHandler(async () => {
      await Bun.sleep(50);
      finished = true;
      return { kind: "ok" };
    });
    const queue = new MemoryQueue();
    const worker = new QueueWorker({
      client: queue,
      registry: new HandlerRegistry().register(handler),
      log: quietLog,
      idleDelayMs: 5,
    });
    queue.send(QUEUES.sync, job());
    worker.start();
    await Bun.sleep(10);
    expect(worker.health().status).toBe("ok");
    await worker.stop();
    expect(finished).toBe(true);
    expect(worker.health().status).toBe("stopped");
    expect(queue.attempts).toHaveLength(1);
  });

  test("health reports processed and failed counts", async () => {
    const { handler } = syncHandler(async () => ({ kind: "fail", errorCode: "unauthorized" }));
    const { queue, worker } = setup(handler);
    queue.send(QUEUES.sync, job());
    await worker.tick(QUEUES.sync);
    expect(worker.health()).toMatchObject({ processed: 1, failed: 1 });
  });
});
