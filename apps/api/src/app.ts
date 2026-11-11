// apps/api: Hono, JSON, versioned under /v1 (06.api-spec.md). Routes live in
// src/routes, one file per group; see routes/index.ts.

import { mapError } from "@mt/http";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";

import type { ApiDeps } from "./http/types";
import { registerRoutes } from "./routes";

export type { ApiDeps } from "./http/types";

export function createApp(deps: ApiDeps): Hono {
  const app = new Hono();
  // 07.security.md "Transport": HSTS, nosniff, and no framing. The API serves JSON only.
  app.use(
    "*",
    secureHeaders({
      xFrameOptions: "DENY",
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    }),
  );
  registerRoutes(app, deps);
  app.notFound((c) => c.json({ error: { code: "not_found", message: "Route not found." } }, 404));
  app.onError((error, c) => {
    const mapped = mapError(error);
    if (mapped.unexpected) deps.log.error("unhandled api error", { error: error.message });
    return c.json(mapped.body, mapped.status as 500);
  });
  return app;
}
