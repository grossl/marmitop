// Message requests (06.api-spec.md "Messages", FR-014).

import { z } from "zod";
import { uuidSchema } from "./common";

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
