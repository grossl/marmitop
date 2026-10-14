// In-memory QueueClient for unit tests of the framework and the handlers.
// It models pgmq closely enough: read hides a message for the visibility
// timeout and bumps its read count; archive removes it; send can delay it.

import type { QueueMessage, QueueName } from "@mt/db";

import type { AttemptRecord, CompleteInput, QueueClient } from "./types";

interface Stored {
  msgId: number;
  queue: QueueName;
  message: unknown;
  readCount: number;
  enqueuedAt: Date;
  visibleAt: number;
}

export class MemoryQueue implements QueueClient {
  readonly attempts: (AttemptRecord & { queue: QueueName; msgId: number })[] = [];
  readonly archived: { queue: QueueName; msgId: number; message: unknown }[] = [];
  readonly sent: { queue: QueueName; message: unknown; delaySeconds: number }[] = [];
  private readonly items: Stored[] = [];
  private nextId = 1;
  /** Milliseconds; tests move it forward to make delayed messages visible. */
  now = 0;

  send(queue: QueueName, message: unknown, delaySeconds = 0): number {
    const msgId = this.nextId++;
    this.items.push({
      msgId,
      queue,
      message,
      readCount: 0,
      enqueuedAt: new Date(this.now),
      visibleAt: this.now + delaySeconds * 1000,
    });
    return msgId;
  }

  pending(queue: QueueName): Stored[] {
    return this.items.filter((i) => i.queue === queue);
  }

  async read(queue: QueueName, visibilityTimeoutSeconds: number, qty: number): Promise<QueueMessage<unknown>[]> {
    const ready = this.items.filter((i) => i.queue === queue && i.visibleAt <= this.now).slice(0, qty);
    return ready.map((i) => {
      i.readCount += 1;
      i.visibleAt = this.now + visibilityTimeoutSeconds * 1000;
      return {
        msgId: i.msgId,
        readCount: i.readCount,
        enqueuedAt: i.enqueuedAt,
        visibleAt: new Date(i.visibleAt),
        message: i.message,
      };
    });
  }

  async complete(input: CompleteInput): Promise<void> {
    if (input.attempt) this.attempts.push({ ...input.attempt, queue: input.queue, msgId: input.msgId });
    const i = this.items.findIndex((x) => x.queue === input.queue && x.msgId === input.msgId);
    if (i >= 0) {
      const [item] = this.items.splice(i, 1);
      this.archived.push({ queue: input.queue, msgId: input.msgId, message: item?.message });
    }
    if (input.retry) {
      this.sent.push({ queue: input.queue, message: input.retry.payload, delaySeconds: input.retry.delaySeconds });
      this.send(input.queue, input.retry.payload, input.retry.delaySeconds);
    }
  }
}
