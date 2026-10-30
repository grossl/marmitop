// Public API routes (06.api-spec.md "Endpoints"; FR-140..FR-145). Each group gets the
// same chain: API key, rate limit, idempotency (POST). Health and the inbound webhooks
// are mounted elsewhere and never pass through it.

import type { PublicApiBackend } from "@mt/http";
import { Hono } from "hono";

import type { ApiDeps } from "../../http/types";
import { customerRoutes } from "./customers";
import { menuRoutes } from "./menu";
import { messageRoutes } from "./messages";
import { apiKeyAuth, idempotency, type PublicEnv, rateLimit } from "./middleware";
import { orderRoutes } from "./orders";
import { printJobRoutes } from "./print-jobs";

function group(deps: ApiDeps, backend: PublicApiBackend): Hono<PublicEnv> {
  return new Hono<PublicEnv>()
    .use("*", apiKeyAuth(deps, backend))
    .use("*", rateLimit(deps, backend))
    .use("*", idempotency(deps, backend));
}

export function registerPublicRoutes(app: Hono, deps: ApiDeps, backend: PublicApiBackend): void {
  app.route("/v1/orders", orderRoutes(group(deps, backend), deps, backend));
  app.route("/v1/customers", customerRoutes(group(deps, backend), deps, backend));
  app.route("/v1/menu", menuRoutes(group(deps, backend), deps, backend));
  app.route("/v1/messages", messageRoutes(group(deps, backend), deps, backend));
  app.route("/v1/print-jobs", printJobRoutes(group(deps, backend), deps, backend));
}
