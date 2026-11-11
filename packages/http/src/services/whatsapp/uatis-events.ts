// One handler for every backend-uatis push event (ADR-023, ADR-042, FR-176).
//
// The push route (`receiveUatisWebhook`) calls `applyUatisEvent` inside the restaurant's
// `system` transaction:
//
//   1. record the event id in `uatis_event_receipts`; an id seen before is a duplicate and
//      nothing else runs. The receipt commits with the rows below, so a rolled-back apply
//      leaves no receipt and the event is applied on the next delivery.
//   2. a message event goes through `applyGatewayMessage` (upsert by external_id, automatic
//      messages, forward-only status, FR-104..FR-106, FR-177).
//   3. `conversation.updated` and unknown types change nothing in v1.

import type { UatisWebhookEvent } from "@mt/core";
import type { Tx } from "@mt/db";

import type { ServiceDeps } from "../../deps";
import { type ApplyResult, applyGatewayMessage } from "./gateway-events";

/** ADR-042: push is the only source; `pull` rows in `uatis_event_receipts` are history. */
export type UatisEventSource = "push";

export type UatisEventResult =
  | ApplyResult
  | { readonly action: "duplicate" }
  | { readonly action: "not_a_message" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The id that names one event: the body `id` (= `X-Uatis-Delivery`). */
export function uatisEventId(event: UatisWebhookEvent, fallback?: string | null): string | null {
  const fromBody = "deliveryId" in event ? event.deliveryId : null;
  if (fromBody && UUID.test(fromBody)) return fromBody;
  return fallback && UUID.test(fallback) ? fallback : null;
}

/**
 * FR-175: an event must come from the organization stored at registration. A null stored
 * organization (a secret typed by hand) skips the check.
 */
export function uatisOrganizationAllowed(stored: string | null, incoming: string | null): boolean {
  return stored === null || stored === incoming;
}

function eventTypeOf(event: UatisWebhookEvent): string {
  return event.type === "ignored" ? event.eventType.slice(0, 64) : event.type;
}

/** Runs in the caller's transaction, under the restaurant's `system` context. */
export async function applyUatisEvent(
  tx: Tx,
  deps: ServiceDeps,
  restaurantId: string,
  event: UatisWebhookEvent,
  meta: { readonly eventId: string | null; readonly source: UatisEventSource },
): Promise<UatisEventResult> {
  if (meta.eventId !== null) {
    const inserted = await tx`
      insert into public.uatis_event_receipts (restaurant_id, event_id, event_type, source)
      values (${restaurantId}, ${meta.eventId}, ${eventTypeOf(event)}, ${meta.source})
      on conflict (restaurant_id, event_id) do nothing
      returning event_id
    `;
    if (inserted.length === 0) return { action: "duplicate" };
  }
  if (event.type !== "message.created" && event.type !== "message.updated") return { action: "not_a_message" };
  return applyGatewayMessage(tx, deps, restaurantId, event.message);
}
