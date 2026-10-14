// One backend-uatis message, from a webhook or the reconciliation poll, becomes
// rows (FR-104..FR-107, 06.api-spec.md "POST /v1/webhooks/uatis"). Both paths
// call `applyGatewayMessage`, so a message that arrives twice creates one row.
//
//   in,  unknown external_id  → ingestInboundMessage + automatic messages
//   in,  known external_id    → status moves forward only (FR-106)
//   out, known external_id    → status moves forward only (FR-106)
//   out, unknown external_id  → ignored in v1. Marmitop stores the id of its
//        own sends only after POST /v1/messages returns, so an echo can arrive
//        first; storing it would duplicate the message (06.api-spec.md).

import { type GatewayMessage, type MessageStatus, nextMessageStatus } from "@mt/core";
import type { Tx } from "@mt/db";

import type { ServiceDeps } from "../../deps";
import { ingestInboundMessage } from "../messaging/ingest-inbound";
import { type AutomaticResult, runInboundAutomation } from "./automatic";

const E164 = /^\+[1-9][0-9]{7,14}$/;

export type ApplyResult =
  | {
      readonly action: "ingested";
      readonly messageId: string;
      readonly conversationId: string;
      readonly automatic: AutomaticResult | null;
    }
  | { readonly action: "status_updated"; readonly status: MessageStatus }
  | { readonly action: "unchanged" }
  | { readonly action: "ignored"; readonly reason: "no_phone" | "unknown_outbound" | "not_found" };

/** FR-106: moves `messages.status` forward by `external_id`. Never backward. */
export async function applyStatusUpdate(
  tx: Tx,
  restaurantId: string,
  externalId: string,
  incoming: MessageStatus | null,
): Promise<ApplyResult> {
  const [row] = await tx<{ id: string; status: MessageStatus }[]>`
    select id, status from public.messages
    where restaurant_id = ${restaurantId} and external_id = ${externalId}
    for update
  `;
  if (row === undefined) return { action: "ignored", reason: "not_found" };
  const next = nextMessageStatus(row.status, incoming);
  if (next === row.status) return { action: "unchanged" };
  await tx`
    update public.messages set status = ${next}
    where id = ${row.id} and restaurant_id = ${restaurantId} and status = ${row.status}
  `;
  return { action: "status_updated", status: next };
}

/** Runs in the caller's transaction, under the restaurant's `system` context. */
export async function applyGatewayMessage(
  tx: Tx,
  deps: ServiceDeps,
  restaurantId: string,
  message: GatewayMessage,
): Promise<ApplyResult> {
  const [known] = await tx<{ id: string }[]>`
    select id from public.messages where restaurant_id = ${restaurantId} and external_id = ${message.externalId}
  `;
  if (known !== undefined) return applyStatusUpdate(tx, restaurantId, message.externalId, message.status);
  if (message.direction === "out") return { action: "ignored", reason: "unknown_outbound" };
  if (message.contactAddress === null || !E164.test(message.contactAddress)) {
    return { action: "ignored", reason: "no_phone" };
  }

  const ingest = await ingestInboundMessage(tx, restaurantId, {
    phone: message.contactAddress,
    body: message.body,
    externalId: message.externalId,
    receivedAt: message.createdAt,
  });
  if (ingest.messageId === null) return { action: "unchanged" };

  const [customer] = await tx<{ name: string }[]>`
    select name from public.customers where id = ${ingest.customerId} and restaurant_id = ${restaurantId}
  `;
  const automatic = await runInboundAutomation(tx, deps, restaurantId, {
    conversationId: ingest.conversationId,
    conversationCreated: ingest.conversationCreated,
    customerName: customer?.name ?? message.contactAddress,
  });
  // P7: emit message.received (FR-146) here, in the same transaction.
  return { action: "ingested", messageId: ingest.messageId, conversationId: ingest.conversationId, automatic };
}
