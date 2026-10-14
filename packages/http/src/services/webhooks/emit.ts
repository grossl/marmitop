// packages/http/src/services/webhooks/emit.ts
//
// Outbound webhook events (FR-146, FR-147; 06.api-spec.md "Outbound webhooks";
// ADR-007, ADR-009). Producers call `emitEvent` inside their own transaction:
//
//   for the restaurant's endpoint, when it is enabled and subscribed to `type`:
//     insert webhook_deliveries (status pending, next_attempt_at now, the exact payload)
//     pgmq.send mt_webhook_deliveries { v: 1, restaurantId, deliveryId }
//
// A rollback drops both. The worker signs and sends (apps/worker
// handlers/webhook-delivery.ts). The sweep (`mt.requeue_due_deliveries`)
// re-enqueues a delivery whose job was lost.
//
// RLS: `webhook_deliveries` accepts inserts from attendants and API keys but
// only admins read it, so the id is generated here and the insert has no
// RETURNING (05.data-model.md "Role rules").

import { randomUUID } from "node:crypto";

import { QUEUES, sendJob, type Tx } from "@mt/db";
import { WEBHOOK_EVENTS, type WebhookDeliveryJob } from "@mt/schemas";

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

export interface WebhookEnvelope {
  readonly id: string;
  readonly type: WebhookEvent;
  readonly created_at: string;
  readonly restaurant_id: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export function buildEventEnvelope(input: {
  readonly deliveryId: string;
  readonly type: WebhookEvent;
  readonly restaurantId: string;
  readonly createdAt: Date;
  readonly data: Readonly<Record<string, unknown>>;
}): WebhookEnvelope {
  return {
    id: input.deliveryId,
    type: input.type,
    created_at: input.createdAt.toISOString(),
    restaurant_id: input.restaurantId,
    data: input.data,
  };
}

export interface EmitOptions {
  /** The envelope's `created_at`. Default: now. */
  readonly now?: Date;
}

/**
 * Queues one delivery of `type` for the restaurant's webhook endpoint, in the caller's
 * transaction. Returns the delivery ids (empty when no enabled endpoint subscribes).
 * `data` is the `data` object of 06.api-spec.md for that event (snake_case).
 */
export async function emitEvent(
  tx: Tx,
  restaurantId: string,
  type: WebhookEvent,
  data: Readonly<Record<string, unknown>>,
  options: EmitOptions = {},
): Promise<string[]> {
  const endpoints = await tx<{ id: string }[]>`
    select id from public.webhook_endpoints
    where restaurant_id = ${restaurantId} and enabled and ${type} = any(events)
  `;
  const now = options.now ?? new Date();
  const ids: string[] = [];
  for (const endpoint of endpoints) {
    const deliveryId = randomUUID();
    const payload = buildEventEnvelope({ deliveryId, type, restaurantId, createdAt: now, data });
    await tx`
      insert into public.webhook_deliveries (id, restaurant_id, endpoint_id, event, payload, status, next_attempt_at)
      values (${deliveryId}, ${restaurantId}, ${endpoint.id}, ${type}, ${JSON.stringify(payload)}::text::jsonb,
              'pending', ${now})
    `;
    const job: WebhookDeliveryJob = { v: 1, restaurantId, deliveryId };
    await sendJob(tx, QUEUES.webhookDeliveries, job);
    ids.push(deliveryId);
  }
  return ids;
}
