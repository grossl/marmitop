// packages/http/src/services/billing/usage.ts
//
// Usage metering (FR-152, FR-156; ADR-008; 05.data-model.md "usage_events").
// Producers call `recordUsage` inside their own transaction:
//
//   order.created  → createOrder (dashboard and API)
//   message.sent   → the worker, when backend-uatis accepts an outbound message
//   invoice.issued → the invoice flow (P6), when web-nf authorizes an invoice
//
// `(kind, ref_id)` is unique, so a retried job never counts twice. The insert has
// no RETURNING: attendants and API keys may insert usage rows but only admins
// read them (05.data-model.md "Role rules").

import type { UsageKind } from "@mt/core";
import type { Tx } from "@mt/db";

export type { UsageKind } from "@mt/core";

export async function recordUsage(
  tx: Tx,
  restaurantId: string,
  kind: UsageKind,
  refId: string,
  occurredAt?: Date,
): Promise<void> {
  await tx`
    insert into public.usage_events (restaurant_id, kind, ref_id, occurred_at)
    values (${restaurantId}, ${kind}, ${refId}, ${occurredAt ?? new Date()})
    on conflict (kind, ref_id) do nothing
  `;
}
