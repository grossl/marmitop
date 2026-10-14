// Public API messages (06.api-spec.md "Messages"; FR-014, FR-117, FR-142; ADR-014).
// `POST /v1/messages` takes a customer, finds the customer's conversation, and runs the
// dashboard's `sendMessageInTx`: the 24-hour window check first (422
// outside_service_window, nothing stored), then the pending row and the job.

import { AppError, assertFreeTextAllowed } from "@mt/core";
import { sendMessageBodySchema } from "@mt/schemas";

import { defineService } from "../../service";
import { sendMessageInTx } from "../messaging/conversations";
import { type ApiMessage, loadApiMessage } from "./views";

export const apiSendMessage = defineService({
  name: "api.messages.send",
  minRole: "attendant",
  input: sendMessageBodySchema,
  run: async ({ tx, ctx, deps, input }): Promise<ApiMessage> => {
    const [customer] = await tx<{ id: string; conversation_id: string | null }[]>`
      select cu.id, c.id as conversation_id
      from public.customers cu
      left join public.conversations c on c.restaurant_id = cu.restaurant_id and c.customer_id = cu.id
      where cu.restaurant_id = ${ctx.restaurantId} and cu.id = ${input.customer_id}
    `;
    if (customer === undefined) throw new AppError("not_found", "Customer not found.");
    // No conversation means the customer never wrote: the window is closed (ADR-014).
    if (customer.conversation_id === null) assertFreeTextAllowed(null, deps.clock.now());
    const sent = await sendMessageInTx(tx, deps, ctx, {
      conversationId: customer.conversation_id as string,
      body: input.body,
      ...(input.order_id !== undefined ? { orderId: input.order_id } : {}),
    });
    const message = await loadApiMessage(tx, ctx.restaurantId, sent.messageId);
    if (message === null) throw new Error("sent message not readable");
    return message;
  },
});
