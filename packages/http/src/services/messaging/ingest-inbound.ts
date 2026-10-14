// packages/http/src/services/messaging/ingest-inbound.ts
//
// The one place an inbound customer message becomes rows (FR-012, FR-048,
// 06.api-spec.md "Webhook handling"). The dev "simulate customer message"
// control (ADR-002), the uatis webhook, and the reconciliation poll call it
// (through services/whatsapp/gateway-events.ts for the last two).
//
// It runs inside the caller's transaction, after `mt.set_context`. It does
// not send automatic messages: the caller runs `runInboundAutomation`
// (services/whatsapp/automatic.ts) when `duplicate` is false.

import type { Tx } from "@mt/db";

import { previewOf } from "./helpers";

export interface IngestInboundInput {
  /** E.164. */
  readonly phone: string;
  readonly body: string;
  /** The gateway message id. Replays of the same id are ignored. Null stores no id. */
  readonly externalId: string | null;
  /** Used only when the customer is new. Falls back to the phone. */
  readonly name?: string | null;
  readonly receivedAt: Date;
}

export interface IngestInboundResult {
  readonly customerId: string;
  readonly conversationId: string;
  /** Null when `externalId` was already stored: nothing changed. */
  readonly messageId: string | null;
  readonly customerCreated: boolean;
  readonly conversationCreated: boolean;
  readonly duplicate: boolean;
}

export async function ingestInboundMessage(
  tx: Tx,
  restaurantId: string,
  input: IngestInboundInput,
): Promise<IngestInboundResult> {
  // Customer: a new phone creates one, a known phone reuses it (FR-047, FR-048).
  const name = (input.name?.trim() || input.phone).slice(0, 120);
  const insertedCustomer = await tx<{ id: string }[]>`
    insert into public.customers (restaurant_id, name, phone)
    values (${restaurantId}, ${name}, ${input.phone})
    on conflict (restaurant_id, phone) do nothing
    returning id
  `;
  let customerId = insertedCustomer[0]?.id;
  const customerCreated = customerId !== undefined;
  if (customerId === undefined) {
    const [existing] = await tx<{ id: string }[]>`
      select id from public.customers where restaurant_id = ${restaurantId} and phone = ${input.phone}
    `;
    if (existing === undefined) throw new Error("customer vanished after upsert");
    customerId = existing.id;
  }

  // Conversation: one per customer.
  const insertedConversation = await tx<{ id: string }[]>`
    insert into public.conversations (restaurant_id, customer_id)
    values (${restaurantId}, ${customerId})
    on conflict (restaurant_id, customer_id) do nothing
    returning id
  `;
  let conversationId = insertedConversation[0]?.id;
  const conversationCreated = conversationId !== undefined;
  if (conversationId === undefined) {
    const [existing] = await tx<{ id: string }[]>`
      select id from public.conversations where restaurant_id = ${restaurantId} and customer_id = ${customerId}
    `;
    if (existing === undefined) throw new Error("conversation vanished after upsert");
    conversationId = existing.id;
  }

  // Message: idempotent on the gateway id.
  const insertedMessage = await tx<{ id: string }[]>`
    insert into public.messages (restaurant_id, conversation_id, direction, body, status, external_id, created_at)
    values (${restaurantId}, ${conversationId}, 'in', ${input.body}, 'delivered', ${input.externalId}, ${input.receivedAt})
    on conflict (restaurant_id, external_id) where external_id is not null do nothing
    returning id
  `;
  const messageId = insertedMessage[0]?.id ?? null;
  if (messageId === null) {
    return { customerId, conversationId, messageId: null, customerCreated, conversationCreated, duplicate: true };
  }

  // The poll can deliver an older message after a newer one: the times only move forward,
  // and the preview follows the newest message (every SET reads the old row).
  await tx`
    update public.conversations set
      last_message_preview = case
        when last_message_at is null or ${input.receivedAt}::timestamptz >= last_message_at then ${previewOf(input.body)}
        else last_message_preview end,
      last_message_at = greatest(coalesce(last_message_at, ${input.receivedAt}::timestamptz), ${input.receivedAt}::timestamptz),
      unread_count = unread_count + 1,
      last_inbound_at = greatest(coalesce(last_inbound_at, ${input.receivedAt}::timestamptz), ${input.receivedAt}::timestamptz)
    where id = ${conversationId} and restaurant_id = ${restaurantId}
  `;

  return { customerId, conversationId, messageId, customerCreated, conversationCreated, duplicate: false };
}
