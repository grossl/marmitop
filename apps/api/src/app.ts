// apps/api: Hono, JSON, versioned under /v1 (06.api-spec.md). Routes live in
// src/routes, one file per group; see routes/index.ts.

import { mapError } from "@mt/http";
import { Hono } from "hono";

import type { ApiDeps } from "./http/types";
import { registerRoutes } from "./routes";

export type { ApiDeps } from "./http/types";

export function createApp(deps: ApiDeps): Hono {
  const app = new Hono();
  registerRoutes(app, deps);
  app.notFound((c) => c.json({ error: { code: "not_found", message: "Route not found." } }, 404));
  app.onError((error, c) => {
    const mapped = mapError(error);
    if (mapped.unexpected) deps.log.error("unhandled api error", { error: error.message });
    return c.json(mapped.body, mapped.status as 500);
  });
  return app;
}
