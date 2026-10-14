// Message requests (06.api-spec.md "Messages", FR-014).

import { z } from "zod";
import { optionalOf, paginationQuerySchema, phoneSchema, searchTermSchema, uuidSchema } from "./common";

/** 1 to 4096 characters after trimming (backend-uatis limit). A blank body sends nothing. */
const bodySchema = z.string().trim().min(1, "Escreva uma mensagem.").max(4096);

/** `POST /v1/messages`. */
export const sendMessageBodySchema = z
  .object({ customer_id: uuidSchema, body: bodySchema, order_id: uuidSchema.optional() })
  .strict();

/** `sendMessage` Server Action. */
export const sendMessageActionSchema = z.object({
  conversationId: uuidSchema,
  body: bodySchema,
  orderId: uuidSchema.optional(),
});

/** `listConversations` Server Action (FR-010, FR-011): search by name, phone, or preview. */
export const listConversationsActionSchema = z.object({
  q: searchTermSchema.optional(),
  cursor: paginationQuerySchema.shape.cursor,
  limit: paginationQuerySchema.shape.limit.optional(),
});

/** `getConversation` and `markConversationRead` Server Actions (FR-012, FR-013). */
export const conversationIdActionSchema = z.object({ conversationId: uuidSchema });

/** `retryMessage` Server Action (FR-019). */
export const retryMessageActionSchema = z.object({ messageId: uuidSchema });

/** `simulateInboundMessage` Server Action: development only (ADR-002). */
export const simulateInboundActionSchema = z.object({
  phone: phoneSchema,
  body: bodySchema,
  name: optionalOf(z.string().trim().max(120)),
});
