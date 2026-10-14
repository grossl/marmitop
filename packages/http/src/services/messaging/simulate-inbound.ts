// Dev-only "Simular mensagem do cliente" (ADR-002, 06.api-spec.md Appendix A
// `simulateInboundMessage`). Admin only. Refused in production.

import { AppError } from "@mt/core";
import { simulateInboundActionSchema } from "@mt/schemas";

import { defineService } from "../../service";
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
    // P5: automatic messages (welcome, closed) run here once the worker exists.
    return { conversationId: result.conversationId, customerId: result.customerId, messageId: result.messageId };
  },
});
