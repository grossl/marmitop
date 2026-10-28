// The worker framework contract (04.architecture.md "Queue design", ADR-007).
//
// A handler owns one (queue, op) pair. It parses its payload with a Zod schema,
// does the work, and returns an outcome. The framework owns everything else:
// reading pgmq, the visibility timeout, the `job_attempts` row, the retry
// schedule (1m/5m/30m/2h/8h, six attempts), archiving, and shutdown.

import type { QueueMessage, QueueName } from "@mt/db";
import type { ZodType, ZodTypeDef } from "zod";

/** `job_attempts.subject_type`. */
export type SubjectType = "message" | "webhook_delivery" | "order_invoice" | "sync" | "ai_turn";

/** Every queue payload carries the tenant and, on a retry, the attempt number. */
export interface JobPayload {
  readonly restaurantId: string;
  readonly attempt?: number | undefined;
}

export interface JobContext<P> {
  readonly queue: QueueName;
  readonly msgId: number;
  readonly payload: P;
  /** 1 for the first try; `payload.attempt` on a retry. */
  readonly attempt: number;
  /** pgmq `read_ct`: greater than 1 when an earlier read of this message did not finish. */
  readonly readCount: number;
  /** Aborted when the worker shuts down. */
  readonly signal: AbortSignal;
}

export type JobOutcome =
  | { readonly kind: "ok"; readonly httpStatus?: number }
  /** Transient: the framework retries on the schedule. The subject stays as it is. */
  | { readonly kind: "retry"; readonly errorCode: string; readonly httpStatus?: number; readonly retryAfterMs?: number }
  /** Permanent or ambiguous: no retry. The handler has already recorded the subject's final state. */
  | { readonly kind: "fail"; readonly errorCode: string; readonly httpStatus?: number };

export interface JobHandler<P extends JobPayload> {
  /** For logs, for example `whatsapp.send`. */
  readonly name: string;
  readonly queue: QueueName;
  /** Matches `payload.op`. Undefined serves every payload of the queue. */
  readonly op?: string | undefined;
  readonly schema: ZodType<P, ZodTypeDef, unknown>;
  readonly subjectType: SubjectType;
  subjectId(payload: P): string | null;
  /** Seconds. Default 60; set it higher when one run can take longer than the HTTP timeout times the pages. */
  readonly visibilityTimeoutSeconds?: number | undefined;
  /**
   * A job a schedule enqueues again each tick (ADR-034): a transient failure ends it with a
   * `transient_error` attempt and no re-send, because the next tick retries. A delayed retry
   * would block the schedule, which skips a restaurant that already has a queued job.
   */
  readonly periodic?: boolean | undefined;
  run(ctx: JobContext<P>): Promise<JobOutcome>;
  /** Called once when the last retry fails, to mark the subject `failed` or `exhausted`. */
  onExhausted?(ctx: JobContext<P>, last: { readonly errorCode: string }): Promise<void>;
}

/** One `job_attempts` row. */
export interface AttemptRecord {
  readonly restaurantId: string;
  readonly subjectType: SubjectType;
  readonly subjectId: string | null;
  readonly attemptNo: number;
  readonly outcome: "ok" | "transient_error" | "permanent_error";
  readonly httpStatus: number | null;
  readonly errorCode: string | null;
  readonly durationMs: number;
}

export interface CompleteInput {
  readonly queue: QueueName;
  readonly msgId: number;
  /** Null when the payload could not be parsed (no trusted restaurant id). */
  readonly attempt: AttemptRecord | null;
  /** Re-send the payload with this delay (a retry). */
  readonly retry?: { readonly payload: unknown; readonly delaySeconds: number };
}

/** The framework's view of pgmq. `PgmqQueueClient` is the real one; `MemoryQueue` the test one. */
export interface QueueClient {
  read(queue: QueueName, visibilityTimeoutSeconds: number, qty: number): Promise<QueueMessage<unknown>[]>;
  /** Writes the attempt row, archives the message, and enqueues the retry, in one transaction. */
  complete(input: CompleteInput): Promise<void>;
}

export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}
