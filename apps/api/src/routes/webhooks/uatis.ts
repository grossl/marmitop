// POST /v1/webhooks/uatis/{restaurant_id} (FR-102..FR-106, FR-118, FR-119).
// Thin: the raw bytes go to `receiveUatisWebhook` in @mt/http, which verifies
// before it parses (07.security.md).

import { MAX_WEBHOOK_BODY_BYTES, SIGNATURE_HEADERS } from "@mt/core";
import { receiveUatisWebhook } from "@mt/http";
import { Hono } from "hono";

import { readRawBody } from "../../http/raw-body";
import type { ApiDeps } from "../../http/types";

export function uatisWebhookRoutes(deps: ApiDeps): Hono {
  return new Hono().post("/:restaurantId", async (c) => {
    const restaurantId = c.req.param("restaurantId");
    const raw = await readRawBody(c.req.raw, MAX_WEBHOOK_BODY_BYTES);
    const result = await receiveUatisWebhook(deps.uatisInbound, {
      restaurantId,
      signatureHeader: c.req.header(SIGNATURE_HEADERS.uatis),
      // Over the cap: an oversized marker so the service answers 413 without the bytes.
      rawBody: raw ?? new Uint8Array(MAX_WEBHOOK_BODY_BYTES + 1),
      now: deps.clock.now(),
    });
    if (result.cause !== undefined) {
      deps.log.error("uatis webhook failed", { error: (result.cause as Error)?.message ?? "unknown" });
    } else if (result.status >= 400) {
      // No restaurant id echo for 401: the log must not become an oracle either.
      deps.log.warn("uatis webhook refused", { status: result.status });
    }
    for (const [k, v] of Object.entries(result.headers ?? {})) c.header(k, v);
    return c.json(result.body, result.status as 200);
  });
}
