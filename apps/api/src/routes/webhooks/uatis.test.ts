// covers FR-102, FR-103, FR-104, FR-118, FR-119, NFR-012, NFR-013, 07.security.md "Inbound webhook verification"
import { beforeEach, describe, expect, test } from "bun:test";
import { FixedClock, MAX_WEBHOOK_BODY_BYTES, signWebhook } from "@mt/core";
import { MemoryUatisInboundStore } from "@mt/http/testing";

import { createApp } from "../../app";

const R = "3f6c1a0e-7a3b-4b1e-9c53-1f3f6d0f6a11";
const OTHER = "0d9e2b34-5c11-4e7a-8d2f-6a5b9c0e1f22";
const UNKNOWN = "7b1d5a40-1111-4c2e-8f00-123456789abc";
const SECRET = "whsec_restaurant_a";
const NOW = new Date("2026-10-13T12:00:30Z");
const T = Math.floor(NOW.getTime() / 1000);

let store: MemoryUatisInboundStore;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  store = new MemoryUatisInboundStore();
  store.secrets.set(R, SECRET);
  store.secrets.set(OTHER, "whsec_restaurant_b");
  app = createApp({ clock: new FixedClock(NOW), uatisInbound: store, log: { info() {}, warn() {}, error() {} } });
});

function event(type = "message.created", id = "msg-1", extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "delivery-1",
    type,
    created_at: "2026-10-13T12:00:00Z",
    organization_id: "org-1",
    data: {
      message: {
        id,
        conversation_id: "conv-1",
        direction: "in",
        content: { type: "text", text: { body: "Oi" } },
        status: { state: "received" },
        contact_address: "+5511999999999",
        created_at: "2026-10-13T12:00:00Z",
        ...extra,
      },
    },
  });
}

function post(restaurantId: string, body: string, header?: string | null) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (header !== null) headers["X-Uatis-Signature"] = header ?? signWebhook(SECRET, T, body);
  return app.request(`/v1/webhooks/uatis/${restaurantId}`, { method: "POST", body, headers });
}

const INVALID = { error: { code: "signature_invalid", message: "Webhook signature is invalid." } };

describe("POST /v1/webhooks/uatis/{restaurant_id}", () => {
  test("a valid signature stores the message and answers 200", async () => {
    const res = await post(R, event());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(store.applied).toHaveLength(1);
    expect(store.applied[0]?.restaurantId).toBe(R);
  });

  test("a tampered body is 401 and writes nothing", async () => {
    const body = event();
    const res = await post(R, body.replace('"Oi"', '"Tchau"'), signWebhook(SECRET, T, body));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(INVALID);
    expect(store.applied).toHaveLength(0);
  });

  test("a stale timestamp (301 s) is 401 even with a correct HMAC", async () => {
    const body = event();
    const res = await post(R, body, signWebhook(SECRET, T - 301, body));
    expect(res.status).toBe(401);
    expect(store.applied).toHaveLength(0);
  });

  test("a future timestamp (301 s) is 401", async () => {
    const body = event();
    const res = await post(R, body, signWebhook(SECRET, T + 301, body));
    expect(res.status).toBe(401);
  });

  test("a timestamp 300 s old still passes", async () => {
    const body = event();
    const res = await post(R, body, signWebhook(SECRET, T - 300, body));
    expect(res.status).toBe(200);
  });

  test("a wrong secret is 401", async () => {
    const body = event();
    const res = await post(R, body, signWebhook("whsec_wrong", T, body));
    expect(res.status).toBe(401);
    expect(store.applied).toHaveLength(0);
  });

  test("another restaurant's secret cannot reach this restaurant", async () => {
    const body = event();
    const res = await post(R, body, signWebhook("whsec_restaurant_b", T, body));
    expect(res.status).toBe(401);
  });

  test("a missing or malformed header is 401", async () => {
    expect((await post(R, event(), null)).status).toBe(401);
    expect((await post(R, event(), "t=abc,v1=zz")).status).toBe(401);
  });

  test("two v1 values pass when one matches (secret rotation)", async () => {
    const body = event();
    const good = signWebhook(SECRET, T, body);
    const res = await post(R, body, `${good},v1=${"0".repeat(64)}`);
    expect(res.status).toBe(200);
  });

  test("an unknown restaurant answers exactly like a bad signature (no oracle, FR-118)", async () => {
    const body = event();
    const unknown = await post(UNKNOWN, body, signWebhook(SECRET, T, body));
    const badSig = await post(R, body, signWebhook("whsec_wrong", T, body));
    expect(unknown.status).toBe(badSig.status);
    expect(await unknown.text()).toBe(await badSig.text());
  });

  test("a disconnected restaurant answers like an unknown one", async () => {
    store.secrets.delete(OTHER);
    const body = event();
    const res = await post(OTHER, body, signWebhook("whsec_restaurant_b", T, body));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(INVALID);
  });

  test("a restaurant id that is not a uuid answers the same 401", async () => {
    const body = event();
    const res = await post("not-a-uuid", body);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(INVALID);
  });

  test("a duplicate event is accepted and stored once (FR-104)", async () => {
    const body = event();
    expect((await post(R, body)).status).toBe(200);
    expect((await post(R, body)).status).toBe(200);
    expect(store.rows.size).toBe(1);
  });

  test("message.updated is applied", async () => {
    await post(R, event());
    const res = await post(R, event("message.updated", "msg-1", { status: { state: "read" } }));
    expect(res.status).toBe(200);
    expect(store.applied.map((a) => a.event.type)).toEqual(["message.created", "message.updated"]);
  });

  test("conversation.updated and unknown event types answer 200 and store nothing", async () => {
    const conv = JSON.stringify({ id: "d", type: "conversation.updated", data: { conversation: { id: "c" } } });
    expect((await post(R, conv)).status).toBe(200);
    const other = JSON.stringify({ id: "d", type: "contact.created", data: {} });
    expect((await post(R, other)).status).toBe(200);
    expect(store.applied).toHaveLength(0);
  });

  test("a signed body that is not JSON is 422", async () => {
    const res = await post(R, "not json");
    expect(res.status).toBe(422);
  });

  test("a signed event with an invalid message is 422 with a path", async () => {
    const body = event("message.created", "");
    const res = await post(R, body);
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: { details: { path: string }[] } };
    expect(json.error.details[0]?.path).toBe("message.id");
  });

  test("a body over 256 KB is 413 before any check", async () => {
    const body = "x".repeat(MAX_WEBHOOK_BODY_BYTES + 1);
    const res = await post(R, body, "t=1,v1=00");
    expect(res.status).toBe(413);
    expect(store.secretLookups).toBe(0);
  });

  test("over 300 requests in a minute for one restaurant is 429 with Retry-After", async () => {
    store.limitPerMinute = 2;
    expect((await post(R, event("message.created", "a"))).status).toBe(200);
    expect((await post(R, event("message.created", "b"))).status).toBe(200);
    const res = await post(R, event("message.created", "c"));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
  });

  test("an unexpected store failure is 500 with no internals", async () => {
    store.failApply = new Error("connection refused at 10.0.0.5");
    const res = await post(R, event());
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("10.0.0.5");
  });

  test("the handler answers well under 500 ms (FR-119)", async () => {
    const started = performance.now();
    for (let i = 0; i < 20; i++) await post(R, event("message.created", `m${i}`));
    expect((performance.now() - started) / 20).toBeLessThan(500);
  });
});

describe("GET /v1/health", () => {
  test("returns ok", async () => {
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("sends HSTS, nosniff, and no-framing headers (07.security.md)", async () => {
    const res = await app.request("/v1/health");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});
