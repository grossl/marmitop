// Handlers keyed by queue and payload op. P6 registers `mt_invoice_jobs`
// (`issue`, `poll`, `cancel`); P7 registers `mt_webhook_deliveries`.

import type { QueueName } from "@mt/db";

import type { JobHandler, JobPayload } from "./types";

/** 04.architecture.md "Queue design": 60 s exceeds the 10 s HTTP timeout times the batch. */
export const DEFAULT_VISIBILITY_TIMEOUT_SECONDS = 60;

/** A registry holds handlers of many payload types. */
type AnyHandler = JobHandler<any>;

export class HandlerRegistry {
  private readonly byQueue = new Map<QueueName, AnyHandler[]>();

  register<P extends JobPayload>(handler: JobHandler<P>): this {
    const list = this.byQueue.get(handler.queue) ?? [];
    if (list.some((h) => h.op === handler.op)) {
      throw new Error(`a handler for ${handler.queue} op ${handler.op ?? "(any)"} is already registered`);
    }
    list.push(handler);
    this.byQueue.set(handler.queue, list);
    return this;
  }

  queues(): QueueName[] {
    return [...this.byQueue.keys()];
  }

  /** The handler for this payload: an exact op match first, then the queue's catch-all. */
  resolve(queue: QueueName, payload: unknown): AnyHandler | undefined {
    const list = this.byQueue.get(queue) ?? [];
    const op =
      typeof payload === "object" && payload !== null && typeof (payload as { op?: unknown }).op === "string"
        ? (payload as { op: string }).op
        : undefined;
    return list.find((h) => h.op !== undefined && h.op === op) ?? list.find((h) => h.op === undefined);
  }

  visibilityTimeoutSeconds(queue: QueueName): number {
    const list = this.byQueue.get(queue) ?? [];
    return Math.max(DEFAULT_VISIBILITY_TIMEOUT_SECONDS, ...list.map((h) => h.visibilityTimeoutSeconds ?? 0));
  }
}
