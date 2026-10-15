// covers FR-175, FR-176, FR-177 (ADR-021, ADR-023): the push route with the exact body and headers
// the backend-uatis worker sends (its apps/worker/src/body.ts and deliver.ts, commit c887ef0).
import { beforeEach, describe, expect, test } from "bun:test";
import { FixedClock, signWebhook } from "@mt/core";
import { MemoryUatisInboundStore, uatisWebhookBody } from "@mt/http/testing";

import { createApp } from "../../app";

const R = "3f6c1a0e-7a3b-4b1e-9c53-1f3f6d0f6a11";
const ORG = "0f8f5c2e-6a51-4c1b-9f0b-2d2c1f3e4a5b";
const SECRET = "Q3hT0kq8yL2m4VdB7nR1sXcJ9fWzA6pE5gHuKiMoNbY";
const NOW = new Date("2026-10-14T12:00:30Z");
const T = Math.floor(NOW.getTime() / 1000);
const INVALID = { error: { code: "signature_invalid", message: "Webhook signature is invalid." } };

let store: MemoryUatisInboundStore;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  store = new MemoryUatisInboundStore();
  store.secrets.set(R, SECRET);
  store.organizations.set(R, ORG);
  app = createApp({ clock: new FixedClock(NOW), uatisInbound: store, log: { info() {}, warn() {}, error() {} } });
});

const inbound = {
  id: "8c1e2a9b-3f4d-4e5a-8b6c-7d8e9f0a1b2c",
  conversation_id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  direction: "in" as const,
  content: { version: "1", type: "text", kind: "text", text: "Oi, tem marmita hoje?" },
  status: { state: "received", errors: [] },
  contact_address: "5511999999999",
  created_at: "2026-10-14T12:00:00.398+00:00",
};

function body(
  opts: { type?: "message.created" | "message.updated"; org?: string; row?: Partial<typeof inbound> | Record<string, unknown>; deliveryId?: string } = {},
) {
  return uatisWebhookBody({
    type: opts.type ?? "message.created",
    organizationId: opts.org ?? ORG,
    row: { ...inbound, ...(opts.row ?? {}) } as never,
    deliveryId: opts.deliveryId ?? "5b0d7d1e-2a4c-4d43-9a39-7f0f2b9d6c11",
    createdAt: "2026-10-14T12:00:00.412+00:00",
  });
}

/** The backend-uatis worker's headers (deliver.ts `headersFor`). */
function post(raw: string, opts: { t?: number; delivery?: string; event?: string } = {}) {
  const parsed = JSON.parse(raw) as { id: string; type: string };
  return app.request(`/v1/webhooks/uatis/${R}`, {
    method: "POST",
    body: raw,
    headers: {
      "Content-Type": "application/json",
      "X-Uatis-Signature": signWebhook(SECRET, opts.t ?? T, raw),
      "X-Uatis-Event": opts.event ?? parsed.type,
      "X-Uatis-Delivery": opts.delivery ?? parsed.id,
      "User-Agent": "uatis-worker/1.0",
    },
  });
}

describe("push in the exact backend-uatis format", () => {
  test("an inbound message.created is applied with the E.164 address and sets last_webhook_at", async () => {
    const res = await post(body());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(store.applied).toHaveLength(1);
    const m = store.applied[0]?.event.message;
    expect(m?.contactAddress).toBe("+5511999999999");
    expect(m?.body).toBe("Oi, tem marmita hoje?");
    expect(m?.externalId).toBe(inbound.id);
    expect(store.lastWebhookAt.get(R)).toEqual(NOW);
    expect(store.receipts.get(R)?.has("5b0d7d1e-2a4c-4d43-9a39-7f0f2b9d6c11")).toBe(true);
  });

  test("another organization_id gets the same 401 as a bad signature and writes nothing", async () => {
    const res = await post(body({ org: "99999999-9999-4999-8999-999999999999" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(INVALID);
    expect(store.applied).toHaveLength(0);
    expect(store.lastWebhookAt.has(R)).toBe(false);
  });

  test("a missing organization_id is 401 when the organization is stored", async () => {
    const raw = JSON.parse(body()) as Record<string, unknown>;
    delete raw.organization_id;
    const res = await post(JSON.stringify(raw));
    expect(res.status).toBe(401);
  });

  test("with no stored organization (secret typed by hand) any organization is accepted", async () => {
    store.organizations.delete(R);
    const res = await post(body({ org: "99999999-9999-4999-8999-999999999999" }));
    expect(res.status).toBe(200);
    expect(store.applied).toHaveLength(1);
  });

  test("the same delivery id re-signed later is applied once (receipt dedupe)", async () => {
    const raw = body();
    expect((await post(raw)).status).toBe(200);
    expect((await post(raw, { t: T + 10 })).status).toBe(200);
    expect(store.applied).toHaveLength(1);
    expect(store.duplicates).toBe(1);
  });

  test("an event first read from the feed is a duplicate when it is pushed", async () => {
    store.receipts.set(R, new Set(["5b0d7d1e-2a4c-4d43-9a39-7f0f2b9d6c11"]));
    expect((await post(body())).status).toBe(200);
    expect(store.applied).toHaveLength(0);
  });

  test("an internal row answers 200 and applies nothing", async () => {
    const res = await post(body({ row: { direction: "internal", contact_address: null } }));
    expect(res.status).toBe(200);
    expect(store.applied).toHaveLength(0);
  });

  test("message.updated to failed carries the WhatsApp error", async () => {
    const res = await post(
      body({
        type: "message.updated",
        deliveryId: "6c1e2a9b-0000-4e5a-8b6c-7d8e9f0a1b2c",
        row: {
          direction: "out",
          content: {},
          status: { state: "failed", errors: [{ code: 131047, title: "Re-engagement message", message: "x", details: null }] },
        },
      }),
    );
    expect(res.status).toBe(200);
    const m = store.applied[0]?.event.message;
    expect(m?.status).toBe("failed");
    expect(m?.failure).toEqual({ code: "whatsapp_131047", message: "Re-engagement message" });
  });
});
