// covers FR-126, FR-127, FR-136, FR-118 (no oracle, applied to web-nf), NFR-012, NFR-013,
// 07.security.md "Inbound webhook verification"
import { beforeEach, describe, expect, test } from "bun:test";
import { FixedClock, MAX_WEBHOOK_BODY_BYTES, signWebhook } from "@mt/core";
import { MemoryUatisInboundStore, MemoryWebNfInboundStore } from "@mt/http/testing";

import { createApp } from "../../app";

const R = "3f6c1a0e-7a3b-4b1e-9c53-1f3f6d0f6a11";
const OTHER = "0d9e2b34-5c11-4e7a-8d2f-6a5b9c0e1f22";
const UNKNOWN = "7b1d5a40-1111-4c2e-8f00-123456789abc";
const SECRET = "whsec_nf_restaurant_a";
const NOW = new Date("2026-10-13T12:00:30Z");
const T = Math.floor(NOW.getTime() / 1000);
const KEY = "4".repeat(44);

let store: MemoryWebNfInboundStore;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  store = new MemoryWebNfInboundStore();
  store.secrets.set(R, SECRET);
  store.secrets.set(OTHER, "whsec_nf_restaurant_b");
  store.addInvoice(R, "inv-1", "processing");
  app = createApp({
    clock: new FixedClock(NOW),
    uatisInbound: new MemoryUatisInboundStore(),
    webNfInbound: store,
    log: { info() {}, warn() {}, error() {} },
  });
});

function event(type = "invoice.authorized", invoiceId = "inv-1", extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "delivery-1",
    type,
    created_at: "2026-10-13T12:00:00Z",
    data: {
      invoice: {
        id: invoiceId,
        kind: "nfce",
        status: type === "invoice.authorized" ? "authorized" : "rejected",
        numero: 12,
        chave_acesso: KEY,
        reference: "0f0e0d0c-0000-4000-8000-000000000001",
      },
      ...extra,
    },
  });
}

function post(restaurantId: string, body: string, header?: string | null) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (header !== null) headers["X-NF-Signature"] = header ?? signWebhook(SECRET, T, body);
  return app.request(`/v1/webhooks/web-nf/${restaurantId}`, { method: "POST", body, headers });
}

const INVALID = { error: { code: "signature_invalid", message: "Webhook signature is invalid." } };

describe("POST /v1/webhooks/web-nf/{restaurant_id}", () => {
  test("a valid invoice.authorized updates the row and answers 200", async () => {
    const res = await post(R, event());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(store.rows.get(`${R}:inv-1`)).toMatchObject({ status: "authorized", numero: 12, chaveAcesso: KEY });
  });

  test("a replayed delivery changes nothing (FR-136)", async () => {
    const body = event();
    expect((await post(R, body)).status).toBe(200);
    const before = { ...store.rows.get(`${R}:inv-1`) };
    expect((await post(R, body)).status).toBe(200);
    expect(store.rows.get(`${R}:inv-1`)).toEqual(before as never);
  });

  test("a final status never moves back (a late invoice.rejected after authorized)", async () => {
    await post(R, event());
    await post(R, event("invoice.rejected"));
    expect(store.rows.get(`${R}:inv-1`)?.status).toBe("authorized");
  });

  test("event.* triggers a refresh and trusts nothing in the body", async () => {
    store.addInvoice(R, "inv-2", "authorized");
    const body = event("event.authorized", "inv-2", {
      event: { id: "ev-1", type: "cancelamento", status: "authorized" },
    });
    const res = await post(R, body);
    expect(res.status).toBe(200);
    expect(store.refreshes).toEqual(["inv-2"]);
    expect(store.rows.get(`${R}:inv-2`)?.status).toBe("authorized");
  });

  test("an unknown invoice id answers 200 (no retry storm)", async () => {
    const res = await post(R, event("invoice.authorized", "inv-unknown"));
    expect(res.status).toBe(200);
  });

  test("a tampered body is 401 and writes nothing", async () => {
    const body = event();
    const res = await post(R, body.replace('"numero":12', '"numero":13'), signWebhook(SECRET, T, body));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(INVALID);
    expect(store.applied).toHaveLength(0);
  });

  test("a stale or future timestamp (301 s) is 401; 300 s passes", async () => {
    const body = event();
    expect((await post(R, body, signWebhook(SECRET, T - 301, body))).status).toBe(401);
    expect((await post(R, body, signWebhook(SECRET, T + 301, body))).status).toBe(401);
    expect((await post(R, body, signWebhook(SECRET, T - 300, body))).status).toBe(200);
  });

  test("the uatis header does not count", async () => {
    const body = event();
    const res = await app.request(`/v1/webhooks/web-nf/${R}`, {
      method: "POST",
      body,
      headers: { "content-type": "application/json", "X-Uatis-Signature": signWebhook(SECRET, T, body) },
    });
    expect(res.status).toBe(401);
  });

  test("another restaurant's secret cannot reach this restaurant", async () => {
    const body = event();
    expect((await post(R, body, signWebhook("whsec_nf_restaurant_b", T, body))).status).toBe(401);
  });

  test("an unknown, a disconnected, and a malformed restaurant answer exactly like a bad signature", async () => {
    const body = event();
    const badSig = await post(R, body, signWebhook("whsec_wrong", T, body));
    const badText = await badSig.text();
    const unknown = await post(UNKNOWN, body, signWebhook(SECRET, T, body));
    expect(unknown.status).toBe(badSig.status);
    expect(await unknown.text()).toBe(badText);
    store.secrets.delete(OTHER);
    const disconnected = await post(OTHER, body, signWebhook("whsec_nf_restaurant_b", T, body));
    expect(await disconnected.text()).toBe(badText);
    const malformed = await post("not-a-uuid", body);
    expect(await malformed.text()).toBe(badText);
  });

  test("a missing or malformed header is 401", async () => {
    expect((await post(R, event(), null)).status).toBe(401);
    expect((await post(R, event(), "t=abc,v1=zz")).status).toBe(401);
  });

  test("a signed body that is not JSON is 422; one without data.invoice.id is 422", async () => {
    expect((await post(R, "not json")).status).toBe(422);
    expect((await post(R, JSON.stringify({ type: "invoice.authorized", data: {} }))).status).toBe(422);
  });

  test("a body over 256 KB is 413 before any check", async () => {
    const res = await post(R, "x".repeat(MAX_WEBHOOK_BODY_BYTES + 1), "t=1,v1=00");
    expect(res.status).toBe(413);
    expect(store.secretLookups).toBe(0);
  });

  test("over the limit per minute is 429 with Retry-After", async () => {
    store.limitPerMinute = 1;
    expect((await post(R, event())).status).toBe(200);
    const res = await post(R, event());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
  });

  test("an unexpected store failure is 500 with no internals", async () => {
    store.failApply = new Error("connection refused at 10.0.0.5");
    const res = await post(R, event());
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("10.0.0.5");
  });
});
