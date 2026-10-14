// POST /v1/webhooks/web-nf/{restaurant_id} (FR-126, FR-127, FR-136; 06.api-spec.md).
// Thin: the raw bytes go to `receiveWebNfWebhook` in @mt/http, which verifies X-NF-Signature
// before it parses (07.security.md).

import { MAX_WEBHOOK_BODY_BYTES, SIGNATURE_HEADERS } from "@mt/core";
import { receiveWebNfWebhook, type WebNfInboundStore } from "@mt/http";
import { Hono } from "hono";

import { readRawBody } from "../../http/raw-body";
import type { ApiDeps } from "../../http/types";

export function webNfWebhookRoutes(deps: ApiDeps, store: WebNfInboundStore): Hono {
  return new Hono().post("/:restaurantId", async (c) => {
    const restaurantId = c.req.param("restaurantId");
    const raw = await readRawBody(c.req.raw, MAX_WEBHOOK_BODY_BYTES);
    const result = await receiveWebNfWebhook(store, {
      restaurantId,
      signatureHeader: c.req.header(SIGNATURE_HEADERS.nf),
      // Over the cap: an oversized marker so the service answers 413 without the bytes.
      rawBody: raw ?? new Uint8Array(MAX_WEBHOOK_BODY_BYTES + 1),
      now: deps.clock.now(),
    });
    if (result.cause !== undefined) {
      deps.log.error("web-nf webhook failed", { error: (result.cause as Error)?.message ?? "unknown" });
    } else if (result.status >= 400) {
      // No restaurant id echo for 401: the log must not become an oracle either.
      deps.log.warn("web-nf webhook refused", { status: result.status });
    }
    for (const [k, v] of Object.entries(result.headers ?? {})) c.header(k, v);
    return c.json(result.body, result.status as 200);
  });
}
