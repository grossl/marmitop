// Dev-only "Simular mensagem do cliente" (ADR-002, 06.api-spec.md Appendix A
// `simulateInboundMessage`). Admin only. Refused in production.

import { AppError } from "@mt/core";
import { simulateInboundActionSchema } from "@mt/schemas";

import { defineService } from "../../service";
import { afterInboundMessage } from "../whatsapp/after-inbound";
import type { AutomaticResult } from "../whatsapp/automatic";
import { ingestInboundMessage } from "./ingest-inbound";

export const simulateInboundMessage = defineService({
  name: "messages.simulateInbound",
  minRole: "admin",
  input: simulateInboundActionSchema,
  run: async ({ tx, ctx, deps, input }) => {
    if (deps.env === "production") throw new AppError("forbidden", "Simulation is disabled in production.");
    const result = await ingestInboundMessage(tx, ctx.restaurantId, {
      phone: input.phone,
      body: input.body,
      externalId: `sim-${crypto.randomUUID()}`,
      name: input.name,
      receivedAt: deps.clock.now(),
    });
    // FR-110, FR-111, FR-239: the same follow-up as the webhook and the poll.
    const [customer] = await tx<{ name: string }[]>`
      select name from public.customers where id = ${result.customerId} and restaurant_id = ${ctx.restaurantId}
    `;
    let automatic: AutomaticResult | null = null;
    if (result.messageId !== null) {
      ({ automatic } = await afterInboundMessage(tx, deps, ctx.restaurantId, {
        customerId: result.customerId,
        customerName: customer?.name ?? input.phone,
        conversationId: result.conversationId,
        conversationCreated: result.conversationCreated,
        messageId: result.messageId,
        body: input.body,
      }));
    }
    return {
      conversationId: result.conversationId,
      customerId: result.customerId,
      messageId: result.messageId,
      automaticKind: automatic?.kind ?? null,
    };
  },
});
