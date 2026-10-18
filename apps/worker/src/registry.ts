// The worker's handler set. P6 adds the `mt_invoice_jobs` handlers (issue, poll,
// cancel) and P7 the `mt_webhook_deliveries` handler, each with one
// `registry.register(...)` line here. P10 adds `mt_ai_turns` (ADR-025).

import type { AssistantModel } from "@mt/core";
import type { ServiceDeps } from "@mt/http";
import { createSafeFetch, SafeFetchWebhookSender } from "@mt/http";

import { HandlerRegistry } from "./framework/registry";
import type { Logger } from "./framework/types";
import { createAiTurnHandler } from "./handlers/ai-turn";
import {
  createInvoiceCancelHandler,
  createInvoiceIssueHandler,
  createInvoicePollHandler,
} from "./handlers/invoice-jobs";
import { createOutboundMessageHandler } from "./handlers/outbound-message";
import { createUatisFeedHandler } from "./handlers/uatis-feed";
import { createWebhookDeliveryHandler } from "./handlers/webhook-delivery";
import { createWhatsAppReconcileHandler } from "./handlers/whatsapp-reconcile";
import { DbFeedStore } from "./stores/feed-store";
import { DbInvoiceJobStore } from "./stores/invoice-store";
import { DbOutboundStore } from "./stores/outbound-store";
import { DbReconcileStore } from "./stores/reconcile-store";
import { DbWebhookDeliveryStore } from "./stores/webhook-delivery-store";

export function buildRegistry(deps: ServiceDeps, log: Logger, model: AssistantModel): HandlerRegistry {
  const gatewayFor = deps.gateways.whatsapp.bind(deps.gateways);
  const reconcileStore = new DbReconcileStore(deps);
  const invoiceDeps = { store: new DbInvoiceJobStore(deps), gatewayFor: deps.gateways.invoices.bind(deps.gateways) };
  return (
    new HandlerRegistry()
      .register(createOutboundMessageHandler({ store: new DbOutboundStore(deps), gatewayFor }))
      .register(createWhatsAppReconcileHandler({ store: reconcileStore, gatewayFor, clock: deps.clock, log }))
      // P10: mt_sync uatis_feed_pull, the backend-uatis event feed (ADR-023)
      .register(
        createUatisFeedHandler({ store: new DbFeedStore(deps), reconcileStore, gatewayFor, clock: deps.clock, log }),
      )
      // P6: mt_invoice_jobs issue | poll | cancel (ADR-003)
      .register(createInvoiceIssueHandler(invoiceDeps))
      .register(createInvoicePollHandler(invoiceDeps))
      .register(createInvoiceCancelHandler(invoiceDeps))
      // P7: mt_webhook_deliveries (FR-146..FR-148, ADR-009)
      .register(
        createWebhookDeliveryHandler({
          store: new DbWebhookDeliveryStore(deps),
          sender: new SafeFetchWebhookSender({
            fetch: createSafeFetch({ allowPrivateHosts: deps.allowPrivateHosts }),
            clock: deps.clock,
          }),
          clock: deps.clock,
        }),
      )
      // P10: mt_ai_turns, the AI order assistant (ADR-025)
      .register(createAiTurnHandler({ serviceDeps: deps, model }))
  );
}
