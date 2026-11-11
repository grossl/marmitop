"use server";

import {
  getConversation,
  listConversations,
  markConversationRead,
  refreshWhatsApp,
  refreshWhatsAppText,
  retryMessage,
  sendMessage,
  setConversationAiMode,
  simulateInboundMessage,
} from "@mt/http";
import {
  conversationIdActionSchema,
  listConversationsActionSchema,
  retryMessageActionSchema,
  sendMessageActionSchema,
  setConversationAiModeSchema,
  simulateInboundActionSchema,
} from "@mt/schemas";

import { z } from "zod";

import { adminAction, memberAction } from "@/lib/server/safe-action";

// Appendix A (06.api-spec.md): listConversations, getConversation,
// markConversationRead, sendMessage, simulateInboundMessage. The screen loads
// data in its Server Component; the client refreshes with router.refresh().

export const listConversationsAction = memberAction(
  { name: "messages.listConversations", input: listConversationsActionSchema },
  ({ deps, ctx, input }) => listConversations(deps, ctx, input),
);

export const getConversationAction = memberAction(
  { name: "messages.getConversation", input: conversationIdActionSchema },
  ({ deps, ctx, input }) => getConversation(deps, ctx, input),
);

export const markConversationReadAction = memberAction(
  { name: "messages.markConversationRead", input: conversationIdActionSchema },
  ({ deps, ctx, input }) => markConversationRead(deps, ctx, input),
);

export const sendMessageAction = memberAction(
  { name: "messages.send", input: sendMessageActionSchema },
  ({ deps, ctx, input }) => sendMessage(deps, ctx, input),
);

/** FR-019: retry a failed outbound message. */
export const retryMessageAction = memberAction(
  { name: "messages.retry", input: retryMessageActionSchema },
  ({ deps, ctx, input }) => retryMessage(deps, ctx, input),
);

/** Development only (ADR-002); the service refuses it in production. */
export const simulateInboundMessageAction = adminAction(
  { name: "messages.simulateInbound", input: simulateInboundActionSchema },
  ({ deps, ctx, input }) => simulateInboundMessage(deps, ctx, input),
);

/** FR-189, FR-190: pause or resume the AI assistant on one conversation. */
export const setConversationAiModeAction = memberAction(
  { name: "messages.setConversationAiMode", input: setConversationAiModeSchema },
  ({ deps, ctx, input }) => setConversationAiMode(deps, ctx, input),
);

/** FR-174 (ADR-042): "Atualizar" enqueues one timestamp poll; Realtime shows what it finds. */
export const refreshWhatsAppAction = memberAction(
  { name: "messages.refreshWhatsApp", input: z.undefined() },
  async ({ deps, ctx }) => {
    const { result } = await refreshWhatsApp(deps, ctx, undefined);
    return { result, message: refreshWhatsAppText(result) };
  },
);
