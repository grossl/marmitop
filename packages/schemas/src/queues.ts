// Queue wire shapes (05.data-model.md "Queues", 04.architecture.md "Queue design"; ADR-007).
// camelCase, versioned with `v`. `restaurantId` lets the worker set the RLS context before it reads a row.

import { z } from "zod";
import { uuidSchema } from "./common";
import { WEBHOOK_EVENTS } from "./integrations";

export const QUEUE_NAMES = ["mt_outbound_messages", "mt_webhook_deliveries", "mt_invoice_jobs", "mt_sync"] as const;

/**
 * The attempt this message carries. Absent means 1. A retry re-sends the job with
 * `attempt + 1` and a delay (ADR-007), so pgmq's own read count stays per message.
 * Six attempts in total (core `MAX_ATTEMPTS`).
 */
export const jobAttemptSchema = z.number().int().min(1).max(6).optional();

export const outboundMessageJobSchema = z.object({
  v: z.literal(1),
  restaurantId: uuidSchema,
  messageId: uuidSchema,
  attempt: jobAttemptSchema,
});
export const webhookDeliveryJobSchema = z.object({
  v: z.literal(1),
  restaurantId: uuidSchema,
  deliveryId: uuidSchema,
  attempt: jobAttemptSchema,
});
export const invoiceJobSchema = z.object({
  v: z.literal(1),
  restaurantId: uuidSchema,
  orderInvoiceId: uuidSchema,
  op: z.enum(["issue", "poll", "cancel"]),
  attempt: jobAttemptSchema,
  /** `poll` only: how many polls ran before this one; sets the next delay (FR-127). Absent means 0. */
  pollRound: z.number().int().min(0).max(1000).optional(),
});
export const syncJobSchema = z.object({
  v: z.literal(1),
  restaurantId: uuidSchema,
  op: z.literal("whatsapp_reconcile"),
  attempt: jobAttemptSchema,
});

/** mt_sync op `uatis_feed_pull`: read the backend-uatis event feed (ADR-023, FR-174). */
export const uatisFeedPullJobSchema = z.object({
  v: z.literal(1),
  restaurantId: uuidSchema,
  op: z.literal("uatis_feed_pull"),
  attempt: jobAttemptSchema,
});

export type OutboundMessageJob = z.infer<typeof outboundMessageJobSchema>;
export type WebhookDeliveryJob = z.infer<typeof webhookDeliveryJobSchema>;
export type InvoiceJob = z.infer<typeof invoiceJobSchema>;
export type SyncJob = z.infer<typeof syncJobSchema>;
export type UatisFeedPullJob = z.infer<typeof uatisFeedPullJobSchema>;

/** The body of every outbound webhook delivery (06.api-spec.md "Outbound webhooks"). */
export const webhookEnvelopeSchema = z.object({
  id: uuidSchema,
  type: z.enum(WEBHOOK_EVENTS),
  created_at: z.string().datetime({ offset: true }),
  restaurant_id: uuidSchema,
  data: z.record(z.unknown()),
});
