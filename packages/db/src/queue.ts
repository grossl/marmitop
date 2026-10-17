// packages/db/src/queue.ts
//
// Thin typed access to the pgmq queues (05.data-model.md "Queues
// (pgmq)", ADR-007). The message shapes live in packages/core; nothing here
// knows what a job means. pgmq functions run as the caller, so the connection
// needs the grants migration 0012 gives `app_service`.
//
// Producers call `sendJob` inside the same transaction as the row the job acts
// on, so a rollback drops the job too.

import type { Tx } from "./client";

export const QUEUES = {
  outboundMessages: "mt_outbound_messages",
  webhookDeliveries: "mt_webhook_deliveries",
  invoiceJobs: "mt_invoice_jobs",
  sync: "mt_sync",
  aiTurns: "mt_ai_turns",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const QUEUE_NAMES: readonly QueueName[] = Object.values(QUEUES);

/** One message as pgmq returns it. */
export interface QueueMessage<T> {
  msgId: number;
  /** How many times the message has been read: the at-least-once counter. */
  readCount: number;
  enqueuedAt: Date;
  /** The message is invisible until this moment. */
  visibleAt: Date;
  message: T;
}

export interface QueueMetrics {
  queueName: string;
  queueLength: number;
  newestMessageAgeSec: number | null;
  oldestMessageAgeSec: number | null;
  totalMessages: number;
}

interface RawMessageRow {
  msg_id: number;
  read_ct: number;
  enqueued_at: Date;
  vt: Date;
  message: unknown;
}

function assertQueue(queue: string): asserts queue is QueueName {
  if (!(QUEUE_NAMES as readonly string[]).includes(queue)) {
    throw new Error(`unknown queue: ${JSON.stringify(queue)}`);
  }
}

/** Enqueues one message, invisible for `delaySeconds`. Returns the pgmq message id. */
export async function sendJob(tx: Tx, queue: QueueName, message: unknown, delaySeconds = 0): Promise<number> {
  assertQueue(queue);
  // `::text::jsonb`: with a bare jsonb cast postgres.js would JSON-encode the
  // already-encoded string and store a JSON string instead of an object.
  const rows = await tx<{ msg_id: number }[]>`
    select pgmq.send(${queue}::text, ${JSON.stringify(message)}::text::jsonb, ${delaySeconds}::integer) as msg_id
  `;
  const row = rows[0];
  if (row === undefined) throw new Error(`pgmq.send returned no message id for ${queue}`);
  return row.msg_id;
}

/**
 * Reads up to `qty` messages and hides them for `visibilityTimeoutSeconds`.
 * A message not deleted or archived in that window becomes visible again, so
 * every consumer must be idempotent (NFR-022).
 */
export async function readJobs<T>(
  tx: Tx,
  queue: QueueName,
  visibilityTimeoutSeconds: number,
  qty = 1,
): Promise<QueueMessage<T>[]> {
  assertQueue(queue);
  const rows = await tx<RawMessageRow[]>`
    select msg_id, read_ct, enqueued_at, vt, message
    from pgmq.read(${queue}::text, ${visibilityTimeoutSeconds}::integer, ${qty}::integer)
  `;
  return rows.map((row) => ({
    msgId: row.msg_id,
    readCount: row.read_ct,
    enqueuedAt: row.enqueued_at,
    visibleAt: row.vt,
    message: row.message as T,
  }));
}

/** Moves a message to its archive table. False when it was already gone. */
export async function archiveJob(tx: Tx, queue: QueueName, msgId: number): Promise<boolean> {
  assertQueue(queue);
  const rows = await tx<{ ok: boolean }[]>`select pgmq.archive(${queue}::text, ${msgId}::bigint) as ok`;
  return rows[0]?.ok ?? false;
}

/** Drops a message without a copy. Prefer `archiveJob` (ADR-007). */
export async function deleteJob(tx: Tx, queue: QueueName, msgId: number): Promise<boolean> {
  assertQueue(queue);
  const rows = await tx<{ ok: boolean }[]>`select pgmq.delete(${queue}::text, ${msgId}::bigint) as ok`;
  return rows[0]?.ok ?? false;
}

/** Sets a message's visibility timeout from now. */
export async function setJobVisibility(
  tx: Tx,
  queue: QueueName,
  msgId: number,
  visibilityTimeoutSeconds: number,
): Promise<void> {
  assertQueue(queue);
  await tx`select pgmq.set_vt(${queue}::text, ${msgId}::bigint, ${visibilityTimeoutSeconds}::integer)`;
}

/** Queue depth and age, for the worker's /health (11.operations.md). */
export async function queueMetrics(tx: Tx, queue: QueueName): Promise<QueueMetrics> {
  assertQueue(queue);
  const rows = await tx<
    {
      queue_name: string;
      queue_length: number;
      newest_msg_age_sec: number | null;
      oldest_msg_age_sec: number | null;
      total_messages: number;
    }[]
  >`
    select queue_name, queue_length, newest_msg_age_sec, oldest_msg_age_sec, total_messages
    from pgmq.metrics(${queue}::text)
  `;
  const row = rows[0];
  if (row === undefined) throw new Error(`pgmq.metrics returned no row for ${queue}`);
  return {
    queueName: row.queue_name,
    queueLength: Number(row.queue_length),
    newestMessageAgeSec: row.newest_msg_age_sec,
    oldestMessageAgeSec: row.oldest_msg_age_sec,
    totalMessages: Number(row.total_messages),
  };
}
