// The worker's handler set. P6 adds the `mt_invoice_jobs` handlers (issue, poll,
// cancel) and P7 the `mt_webhook_deliveries` handler, each with one
// `registry.register(...)` line here.

import type { ServiceDeps } from "@mt/http";
import { createSafeFetch, SafeFetchWebhookSender } from "@mt/http";

import { HandlerRegistry } from "./framework/registry";
import type { Logger } from "./framework/types";
import {
  createInvoiceCancelHandler,
  createInvoiceIssueHandler,
  createInvoicePollHandler,
} from "./handlers/invoice-jobs";
import { createOutboundMessageHandler } from "./handlers/outbound-message";
import { createWhatsAppReconcileHandler } from "./handlers/whatsapp-reconcile";
import { createWebhookDeliveryHandler } from "./handlers/webhook-delivery";
import { DbInvoiceJobStore } from "./stores/invoice-store";
import { DbOutboundStore } from "./stores/outbound-store";
import { DbReconcileStore } from "./stores/reconcile-store";
import { DbWebhookDeliveryStore } from "./stores/webhook-delivery-store";

export function buildRegistry(deps: ServiceDeps, log: Logger): HandlerRegistry {
  const gatewayFor = deps.gateways.whatsapp.bind(deps.gateways);
  const invoiceDeps = { store: new DbInvoiceJobStore(deps), gatewayFor: deps.gateways.invoices.bind(deps.gateways) };
  return (
    new HandlerRegistry()
      .register(createOutboundMessageHandler({ store: new DbOutboundStore(deps), gatewayFor }))
      .register(
        createWhatsAppReconcileHandler({ store: new DbReconcileStore(deps), gatewayFor, clock: deps.clock, log }),
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
  );
}
