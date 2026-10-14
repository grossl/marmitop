// The worker's handler set. P6 adds the `mt_invoice_jobs` handlers (issue, poll,
// cancel) and P7 the `mt_webhook_deliveries` handler, each with one
// `registry.register(...)` line here.

import type { ServiceDeps } from "@mt/http";

import { HandlerRegistry } from "./framework/registry";
import type { Logger } from "./framework/types";
import { createOutboundMessageHandler } from "./handlers/outbound-message";
import { createWhatsAppReconcileHandler } from "./handlers/whatsapp-reconcile";
import { DbOutboundStore } from "./stores/outbound-store";
import { DbReconcileStore } from "./stores/reconcile-store";

export function buildRegistry(deps: ServiceDeps, log: Logger): HandlerRegistry {
  const gatewayFor = deps.gateways.whatsapp.bind(deps.gateways);
  return new HandlerRegistry()
    .register(createOutboundMessageHandler({ store: new DbOutboundStore(deps), gatewayFor }))
    .register(
      createWhatsAppReconcileHandler({ store: new DbReconcileStore(deps), gatewayFor, clock: deps.clock, log }),
    );
}
