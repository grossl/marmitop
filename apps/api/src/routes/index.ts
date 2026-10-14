// Route registry. One file per route group, mounted under /v1:
//
//   routes/health.ts               GET  /v1/health
//   routes/webhooks/uatis.ts       POST /v1/webhooks/uatis/{restaurant_id}   (P5)
//   routes/webhooks/web-nf.ts      POST /v1/webhooks/web-nf/{restaurant_id}  (P6 adds)
//   routes/public/*.ts             /v1/orders, /v1/customers, /v1/menu, /v1/messages
//                                  behind the API-key middleware             (P7 adds)

import type { Hono } from "hono";

import type { ApiDeps } from "../http/types";
import { healthRoutes } from "./health";
import { uatisWebhookRoutes } from "./webhooks/uatis";

export function registerRoutes(app: Hono, deps: ApiDeps): void {
  app.route("/v1", healthRoutes());
  app.route("/v1/webhooks/uatis", uatisWebhookRoutes(deps));
}
