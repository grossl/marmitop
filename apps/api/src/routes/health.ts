import { Hono } from "hono";

/** GET /v1/health: liveness only, no auth (06.api-spec.md). */
export function healthRoutes(): Hono {
  return new Hono().get("/health", (c) => c.json({ status: "ok" }));
}
