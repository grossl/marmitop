// Webhook deliveries: what the worker reads and writes for one send, and the admin's
// delivery list and redeliver (FR-148, FR-149; 06.api-spec.md Appendix A
// `listWebhookDeliveries`, `redeliverWebhook`; 05.data-model.md "webhook_deliveries").
//
// The worker runs these under the restaurant's `system` context (RLS: admin), so it may
// read the delivery, the endpoint, and unseal the signing secret. Nothing here returns
// or logs the secret beyond the caller (NFR-011).

import { AppError } from "@mt/core";
import { QUEUES, sendJob, type Tx } from "@mt/db";
import { uuidSchema, type WebhookDeliveryJob } from "@mt/schemas";
import { z } from "zod";

import type { ServiceDeps } from "../../deps";
import { defineService } from "../../service";
import { openSecret } from "../admin/internal";
import { systemCtx } from "../whatsapp/connection";

export type WebhookDeliveryStatus = "pending" | "delivered" | "failed" | "exhausted";

export interface DeliveryForSend {
  readonly status: WebhookDeliveryStatus;
  readonly attempts: number;
  readonly event: string;
  readonly body: string;
  readonly endpoint: { readonly url: string; readonly enabled: boolean; readonly secret: string };
}

/** Null when the delivery is gone (trimmed, or the endpoint was deleted). */
export async function loadDeliveryForSend(
  tx: Tx,
  deps: ServiceDeps,
  restaurantId: string,
  deliveryId: string,
): Promise<DeliveryForSend | null> {
  const [row] = await tx<
    {
      status: WebhookDeliveryStatus;
      attempts: number;
      event: string;
      payload: unknown;
      url: string;
      enabled: boolean;
      secret_id: string;
    }[]
  >`
    select d.status, d.attempts, d.event, d.payload, e.url, e.enabled, e.secret_id
    from public.webhook_deliveries d
    join public.webhook_endpoints e on e.restaurant_id = d.restaurant_id and e.id = d.endpoint_id
    where d.restaurant_id = ${restaurantId} and d.id = ${deliveryId}
    for update of d
  `;
  if (row === undefined) return null;
  const secret = await openSecret(tx, deps, systemCtx(restaurantId), row.secret_id, "outbound_webhook_secret");
  return {
    status: row.status,
    attempts: row.attempts,
    event: row.event,
    // jsonb comes back parsed; one stringify gives the same bytes on every attempt.
    body: JSON.stringify(row.payload),
    endpoint: { url: row.url, enabled: row.enabled, secret },
  };
}

export interface RecordedAttempt {
  readonly attemptNo: number;
  readonly status: "delivered" | "failed" | "exhausted";
  readonly statusCode: number | null;
  readonly error: string | null;
  readonly nextAttemptAt: Date | null;
  readonly at: Date;
}

/** One attempt on the row: status, attempts, last status code and error, next attempt, delivered_at. */
export async function recordDeliveryAttempt(
  tx: Tx,
  restaurantId: string,
  deliveryId: string,
  a: RecordedAttempt,
): Promise<void> {
  await tx`
    update public.webhook_deliveries set
      status = ${a.status},
      attempts = ${a.attemptNo},
      last_status_code = ${a.statusCode},
      last_error = ${a.error === null ? null : a.error.slice(0, 200)},
      next_attempt_at = ${a.nextAttemptAt},
      delivered_at = ${a.status === "delivered" ? a.at : null}
    where restaurant_id = ${restaurantId} and id = ${deliveryId} and status in ('pending', 'failed')
  `;
}

export async function markDeliveryExhausted(
  tx: Tx,
  restaurantId: string,
  deliveryId: string,
  errorCode: string,
): Promise<void> {
  await tx`
    update public.webhook_deliveries set status = 'exhausted', last_error = ${errorCode.slice(0, 200)},
      next_attempt_at = null
    where restaurant_id = ${restaurantId} and id = ${deliveryId} and status in ('pending', 'failed')
  `;
}

// ---------------------------------------------------------------------------
// Settings → Webhook: recent deliveries and redeliver (FR-149). Admin only.
// ---------------------------------------------------------------------------

export interface WebhookDeliveryView {
  readonly id: string;
  readonly event: string;
  readonly status: WebhookDeliveryStatus;
  readonly attempts: number;
  readonly lastStatusCode: number | null;
  readonly lastError: string | null;
  readonly nextAttemptAt: string | null;
  readonly deliveredAt: string | null;
  readonly createdAt: string;
}

export const RECENT_DELIVERIES_LIMIT = 50;

export const listWebhookDeliveries = defineService({
  name: "settings.listWebhookDeliveries",
  minRole: "admin",
  input: z.undefined(),
  run: async ({ tx, ctx }): Promise<WebhookDeliveryView[]> => {
    const rows = await tx<
      {
        id: string;
        event: string;
        status: WebhookDeliveryStatus;
        attempts: number;
        last_status_code: number | null;
        last_error: string | null;
        next_attempt_at: Date | null;
        delivered_at: Date | null;
        created_at: Date;
      }[]
    >`
      select id, event, status, attempts, last_status_code, last_error, next_attempt_at, delivered_at, created_at
      from public.webhook_deliveries
      where restaurant_id = ${ctx.restaurantId}
      order by created_at desc, id desc
      limit ${RECENT_DELIVERIES_LIMIT}
    `;
    return rows.map((r) => ({
      id: r.id,
      event: r.event,
      status: r.status,
      attempts: r.attempts,
      lastStatusCode: r.last_status_code,
      lastError: r.last_error,
      nextAttemptAt: r.next_attempt_at?.toISOString() ?? null,
      deliveredAt: r.delivered_at?.toISOString() ?? null,
      createdAt: r.created_at.toISOString(),
    }));
  },
});

/**
 * FR-149: send a delivered or exhausted delivery again, with the same id and body. The
 * attempt count starts over. A delivery still `pending` or `failed` is already scheduled:
 * 409 conflict.
 */
export const redeliverWebhook = defineService({
  name: "settings.redeliverWebhook",
  minRole: "admin",
  input: z.object({ deliveryId: uuidSchema }),
  run: async ({ tx, ctx, deps, input }): Promise<{ id: string }> => {
    const [row] = await tx<{ status: WebhookDeliveryStatus }[]>`
      select status from public.webhook_deliveries
      where restaurant_id = ${ctx.restaurantId} and id = ${input.deliveryId}
      for update
    `;
    if (row === undefined) throw new AppError("not_found", "Delivery not found.");
    if (row.status === "pending" || row.status === "failed") {
      throw new AppError("conflict", "This delivery is already scheduled.");
    }
    await tx`
      update public.webhook_deliveries set status = 'pending', attempts = 0, last_status_code = null,
        last_error = null, delivered_at = null, next_attempt_at = ${deps.clock.now()}
      where restaurant_id = ${ctx.restaurantId} and id = ${input.deliveryId}
    `;
    const job: WebhookDeliveryJob = { v: 1, restaurantId: ctx.restaurantId, deliveryId: input.deliveryId };
    await sendJob(tx, QUEUES.webhookDeliveries, job);
    return { id: input.deliveryId };
  },
});
