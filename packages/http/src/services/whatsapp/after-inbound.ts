// What runs after a new inbound message is stored (FR-110, FR-111, FR-181, FR-239). The uatis
// webhook, the reconciliation poll, and the dev simulation call it, in the ingest transaction.
//
//   1. convertMenuOrderDraft: a message with a menu draft reference becomes an order (ADR-033).
//      createOrderInTx sends `order_received`. No welcome or closed message, no AI turn, and the
//      AI pauses with reason `attendant`: a person confirms the order (ADR-031).
//   2. Otherwise: the automatic messages, then the AI turn.

import type { Tx } from "@mt/db";

import type { ServiceDeps } from "../../deps";
import { pauseConversation } from "../ai/messages";
import { loadAiSettings } from "../ai/settings";
import { enqueueAiTurn } from "../ai/trigger";
import { type ConvertedMenuOrder, convertMenuOrderDraft } from "../orders/menu-order-drafts";
import { type AutomaticResult, runInboundAutomation } from "./automatic";

export interface AfterInboundInput {
  readonly customerId: string;
  readonly customerName: string;
  readonly conversationId: string;
  readonly conversationCreated: boolean;
  readonly messageId: string;
  readonly body: string;
}

export interface AfterInboundResult {
  readonly automatic: AutomaticResult | null;
  /** The order a menu draft became (FR-239); null for any other message. */
  readonly menuOrder: ConvertedMenuOrder | null;
}

export async function afterInboundMessage(
  tx: Tx,
  deps: ServiceDeps,
  restaurantId: string,
  input: AfterInboundInput,
): Promise<AfterInboundResult> {
  const menuOrder = await convertMenuOrderDraft(tx, deps, restaurantId, {
    body: input.body,
    customerId: input.customerId,
    conversationId: input.conversationId,
  });
  if (menuOrder !== null) {
    // The AI does not know menu orders; it would read the order text and create it again.
    if ((await loadAiSettings(tx, restaurantId)).enabled) {
      await pauseConversation(tx, restaurantId, input.conversationId, "attendant", null, deps.clock.now());
    }
    return { automatic: null, menuOrder };
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
  return { automatic, menuOrder: null };
}
