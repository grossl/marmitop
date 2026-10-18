// Dev-only "Simular mensagem do cliente" (ADR-002, 06.api-spec.md Appendix A
// `simulateInboundMessage`). Admin only. Refused in production.

import { AppError } from "@mt/core";
import { simulateInboundActionSchema } from "@mt/schemas";

import { defineService } from "../../service";
import { enqueueAiTurn } from "../ai/trigger";
import { type AutomaticResult, runInboundAutomation } from "../whatsapp/automatic";
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
    // FR-110, FR-111: the same automatic messages as the webhook and the poll.
    const [customer] = await tx<{ name: string }[]>`
      select name from public.customers where id = ${result.customerId} and restaurant_id = ${ctx.restaurantId}
    `;
    let automatic: AutomaticResult | null = null;
    if (result.messageId !== null) {
      automatic = await runInboundAutomation(tx, deps, ctx.restaurantId, {
        conversationId: result.conversationId,
        conversationCreated: result.conversationCreated,
        customerName: customer?.name ?? input.phone,
      });
      await enqueueAiTurn(tx, deps, ctx.restaurantId, {
        conversationId: result.conversationId,
        triggerMessageId: result.messageId,
        closedSent: automatic?.kind === "closed",
      });
    }
    return {
      conversationId: result.conversationId,
      customerId: result.customerId,
      messageId: result.messageId,
      automaticKind: automatic?.kind ?? null,
    };
  },
});
