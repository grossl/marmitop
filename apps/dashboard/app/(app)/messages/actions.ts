"use server";

import {
  getConversation,
  listConversations,
  markConversationRead,
  retryMessage,
  sendMessage,
  simulateInboundMessage,
} from "@mt/http";
import {
  conversationIdActionSchema,
  listConversationsActionSchema,
  retryMessageActionSchema,
  sendMessageActionSchema,
  simulateInboundActionSchema,
} from "@mt/schemas";

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
