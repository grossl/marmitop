// What runs after a new inbound message is stored (FR-110, FR-111, FR-181, FR-239). The uatis
// webhook, the reconciliation poll, and the dev simulation call it, in the ingest transaction.
//
//   1. linkMenuOrders: the customer's open menu orders get this conversation (ADR-032).
//   2. A linked order: `order_received` for each order, no welcome or closed message, no AI
//      turn, and the AI pauses with reason `attendant`. A person confirms the order (ADR-031).
//   3. Otherwise: the automatic messages, then the AI turn.

import type { Tx } from "@mt/db";

import type { ServiceDeps } from "../../deps";
import { pauseConversation } from "../ai/messages";
import { loadAiSettings } from "../ai/settings";
import { enqueueAiTurn } from "../ai/trigger";
import { type AutomaticResult, enqueueOrderReceived, runInboundAutomation } from "./automatic";

/** FR-239: a menu order links only while it is this young. */
export const MENU_ORDER_LINK_HOURS = 24;

export interface LinkedMenuOrder {
  readonly id: string;
  readonly code: string;
}

/**
 * FR-239: sets `conversation_id` on the customer's menu orders that have none, are still
 * `aguardando`, and were created in the last 24 hours. The customer comes from the sender's
 * phone, which WhatsApp proves, so status messages go only to the person who wrote.
 */
export async function linkMenuOrders(
  tx: Tx,
  restaurantId: string,
  input: { readonly customerId: string; readonly conversationId: string },
): Promise<LinkedMenuOrder[]> {
  // Database time on both sides: `created_at` defaults to now().
  return tx<LinkedMenuOrder[]>`
    update public.orders set conversation_id = ${input.conversationId}
    where restaurant_id = ${restaurantId} and customer_id = ${input.customerId}
      and source = 'menu' and conversation_id is null and status = 'aguardando'
      and created_at >= now() - make_interval(hours => ${MENU_ORDER_LINK_HOURS})
    returning id, code
  `;
}

export interface AfterInboundInput {
  readonly customerId: string;
  readonly customerName: string;
  readonly conversationId: string;
  readonly conversationCreated: boolean;
  readonly messageId: string;
}

export interface AfterInboundResult {
  readonly automatic: AutomaticResult | null;
  readonly linkedOrders: readonly LinkedMenuOrder[];
}

export async function afterInboundMessage(
  tx: Tx,
  deps: ServiceDeps,
  restaurantId: string,
  input: AfterInboundInput,
): Promise<AfterInboundResult> {
  const now = deps.clock.now();
  const linkedOrders = await linkMenuOrders(tx, restaurantId, {
    customerId: input.customerId,
    conversationId: input.conversationId,
  });

  if (linkedOrders.length > 0) {
    let automatic: AutomaticResult | null = null;
    for (const order of linkedOrders) {
      const outcome = await enqueueOrderReceived(tx, deps, restaurantId, {
        orderId: order.id,
        orderCode: order.code,
        customerName: input.customerName,
        conversationId: input.conversationId,
      });
      if (outcome.action !== "skip") automatic ??= { kind: "order_received", messageId: outcome.messageId };
    }
    // The AI does not know menu orders; it would read the order text and create it again.
    if ((await loadAiSettings(tx, restaurantId)).enabled) {
      await pauseConversation(tx, restaurantId, input.conversationId, "attendant", null, now);
    }
    return { automatic, linkedOrders };
  }

  const automatic = await runInboundAutomation(tx, deps, restaurantId, {
    conversationId: input.conversationId,
    conversationCreated: input.conversationCreated,
    customerName: input.customerName,
  });
  await enqueueAiTurn(tx, deps, restaurantId, {
    conversationId: input.conversationId,
    triggerMessageId: input.messageId,
    closedSent: automatic?.kind === "closed",
  });
  return { automatic, linkedOrders };
}
