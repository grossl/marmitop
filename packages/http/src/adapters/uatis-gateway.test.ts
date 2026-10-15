// covers FR-100, FR-101, FR-107, FR-108, ADR-002, ADR-014, ADR-017 #4
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { classifyOutboundSend, classifyUpstreamFailure, GatewayError } from "@mt/core";
import { whatsappGatewayContract } from "@mt/core/contracts";

import { FakeUatisServer } from "../testing/fake-uatis-server";
import { createSafeFetch } from "./safe-fetch";
import { UatisGateway } from "./uatis-gateway";

const devFetch = (timeoutMs = 2000) => createSafeFetch({ allowPrivateHosts: true, timeoutMs });

whatsappGatewayContract("UatisGateway against a local backend-uatis stand-in", async () => {
  const server = new FakeUatisServer().start();
  const gateway = new UatisGateway({ baseUrl: server.baseUrl, apiKey: server.apiKey, fetch: devFetch() });
  return {
    gateway,
    injectInbound: async (from, body) => void server.injectInbound(from, body),
    cleanup: () => server.stop(),
  };
});

let server: FakeUatisServer;
let gateway: UatisGateway;

beforeEach(() => {
  server = new FakeUatisServer().start();
  gateway = new UatisGateway({ baseUrl: `${server.baseUrl}/`, apiKey: server.apiKey, fetch: devFetch(300) });
});

afterEach(async () => {
  await server.stop();
});

async function failure(p: Promise<unknown>): Promise<GatewayError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof GatewayError) return e;
    throw new Error(`expected a GatewayError, got ${String(e)}`);
  }
  throw new Error("expected a failure");
}

const text = { to: "+5511999990000", fromAddress: "pn-1", body: "Olá!" };

describe("UatisGateway requests", () => {
  test("sendText posts to, from_address, and text with the Bearer key", async () => {
    await gateway.sendText(text);
    const req = server.requests.at(-1);
    expect(req?.method).toBe("POST");
    expect(req?.path).toBe("/v1/messages");
    expect(req?.authorization).toBe(`Bearer ${server.apiKey}`);
    expect(req?.body).toEqual({ to: "+5511999990000", from_address: "pn-1", text: { body: "Olá!" } });
  });

  test("sendTemplate posts the template name and language", async () => {
    await gateway.sendTemplate({
      to: "+5511999990000",
      fromAddress: "pn-1",
      templateName: "pedido",
      language: "pt_BR",
    });
    expect(server.requests.at(-1)?.body).toEqual({
      to: "+5511999990000",
      from_address: "pn-1",
      template: { name: "pedido", language: "pt_BR", components: [] },
    });
  });

  test("listMessages passes direction, from, cursor, and limit as query parameters", async () => {
    const from = new Date("2026-10-13T12:00:00Z");
    await gateway.listMessages({ direction: "in", from, limit: 10 });
    expect(server.requests.at(-1)?.query).toEqual({ direction: "in", from: from.toISOString(), limit: "10" });
  });

  test("listMessages reads the stored text shape and skips internal rows", async () => {
    server.injectInbound("5511988887777", "Oi");
    server.injectInternal("tool call");
    const page = await gateway.listMessages();
    expect(page.items.map((m) => m.body)).toEqual(["Oi"]);
    expect(page.items[0]?.contactAddress).toBe("+5511988887777");
  });

  test("listApprovedTemplates maps name and language", async () => {
    server.templates = [
      { id: "1", name: "pedido_recebido", language: "pt_BR", status: "approved", category: "UTILITY" },
    ];
    expect(await gateway.listApprovedTemplates()).toEqual([{ name: "pedido_recebido", language: "pt_BR" }]);
  });

  test("testConnection is ok with a valid key", async () => {
    expect(await gateway.testConnection()).toEqual({ ok: true });
  });

  test("testConnection reports a refused key without throwing", async () => {
    const bad = new UatisGateway({ baseUrl: server.baseUrl, apiKey: "obk_test_wrong", fetch: devFetch() });
    const r = await bad.testConnection();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("chave");
  });

  test("testConnection reports an unreachable host without throwing", async () => {
    const off = new UatisGateway({ baseUrl: "http://127.0.0.1:1", apiKey: "k", fetch: devFetch() });
    const r = await off.testConnection();
    expect(r.ok).toBe(false);
  });
});

describe("UatisGateway error classification (ADR-017 #4)", () => {
  test("422 outside_service_window is permanent with that code", async () => {
    server.scriptNext("POST /v1/messages", { kind: "status", status: 422, code: "outside_service_window" });
    const e = await failure(gateway.sendText(text));
    expect(classifyOutboundSend(e.failure)).toEqual({ failure: "permanent", errorCode: "outside_service_window" });
  });

  test("422 whatsapp_disconnected is permanent with that code", async () => {
    server.lineConnected = false;
    const e = await failure(gateway.sendText(text));
    expect(classifyOutboundSend(e.failure)).toEqual({ failure: "permanent", errorCode: "whatsapp_disconnected" });
  });

  test("a 5xx after the send is ambiguous: no retry", async () => {
    server.scriptNext("POST /v1/messages", { kind: "status", status: 502 });
    const e = await failure(gateway.sendText(text));
    expect(classifyOutboundSend(e.failure).failure).toBe("ambiguous");
  });

  test("a timeout after the send is ambiguous: no retry", async () => {
    server.scriptNext("POST /v1/messages", { kind: "delay", ms: 800 });
    const e = await failure(gateway.sendText(text));
    expect(e.failure.kind).toBe("timeout");
    expect(classifyOutboundSend(e.failure).failure).toBe("ambiguous");
  });

  test("a garbled 2xx after the send is ambiguous: the message may exist", async () => {
    server.scriptNext("POST /v1/messages", { kind: "garbage" });
    const e = await failure(gateway.sendText(text));
    expect(classifyOutboundSend(e.failure).failure).toBe("ambiguous");
  });

  test("a connection error before the send is transient: retry", async () => {
    const off = new UatisGateway({ baseUrl: "http://127.0.0.1:1", apiKey: "k", fetch: devFetch() });
    const e = await failure(off.sendText(text));
    expect(classifyOutboundSend(e.failure)).toEqual({ failure: "transient", errorCode: "connection_error" });
  });

  test("401 is permanent unauthorized", async () => {
    const bad = new UatisGateway({ baseUrl: server.baseUrl, apiKey: "obk_test_wrong", fetch: devFetch() });
    const e = await failure(bad.sendText(text));
    expect(classifyOutboundSend(e.failure)).toEqual({ failure: "permanent", errorCode: "unauthorized" });
  });

  test("429 carries Retry-After and is transient", async () => {
    server.scriptNext("POST /v1/messages", { kind: "status", status: 429, code: "rate_limited", retryAfter: "120" });
    const e = await failure(gateway.sendText(text));
    expect(e.retryAfterMs).toBe(120_000);
    expect(classifyOutboundSend(e.failure).failure).toBe("transient");
  });

  test("a 5xx on a poll read is transient", async () => {
    server.scriptNext("GET /v1/messages", { kind: "status", status: 503 });
    const e = await failure(gateway.listMessages({ direction: "in" }));
    expect(classifyUpstreamFailure(e.failure).failure).toBe("transient");
  });

  test("a private base URL is refused when the guard is on", async () => {
    const prod = new UatisGateway({
      baseUrl: server.baseUrl,
      apiKey: server.apiKey,
      fetch: createSafeFetch({ allowPrivateHosts: false }),
    });
    const e = await failure(prod.sendText(text));
    expect(classifyOutboundSend(e.failure).failure).toBe("permanent");
    expect(server.requests.length).toBe(0);
  });
});

// covers FR-170, FR-171, FR-173, FR-178 (ADR-021): webhook management requests.
describe("UatisGateway webhook management", () => {
  test("getOrganization reads GET /v1/organizations/current", async () => {
    const org = await gateway.getOrganization();
    expect(org.id).toBe(server.organizationId);
    const req = server.requests.at(-1);
    expect(req?.method).toBe("GET");
    expect(req?.path).toBe("/v1/organizations/current");
    expect(req?.authorization).toBe(`Bearer ${server.apiKey}`);
  });

  test("createWebhook posts url, events, and description and returns the secret", async () => {
    const hook = await gateway.createWebhook({
      mode: "push",
      url: "https://mt.example.com/v1/webhooks/uatis/r1",
      events: ["message.created", "message.updated"],
      description: "Marmitop",
    });
    const req = server.requests.at(-1);
    expect(req?.method).toBe("POST");
    expect(req?.path).toBe("/v1/webhooks");
    expect(req?.body).toEqual({
      mode: "push",
      url: "https://mt.example.com/v1/webhooks/uatis/r1",
      events: ["message.created", "message.updated"],
      description: "Marmitop",
    });
    expect(hook.secret).toBe(server.webhooks.get(hook.id)?.secret ?? "missing");
  });

  test("a pull webhook posts mode pull with no url and gets no secret", async () => {
    const hook = await gateway.createWebhook({
      mode: "pull",
      url: null,
      events: ["message.created", "message.updated"],
      description: "Marmitop",
    });
    expect(server.requests.at(-1)?.body).toEqual({
      mode: "pull",
      events: ["message.created", "message.updated"],
      description: "Marmitop",
    });
    expect(hook).toMatchObject({ mode: "pull", url: null, secret: null });
  });

  test("a 422 for a refused URL is a GatewayError with the code", async () => {
    const e = await failure(
      gateway.createWebhook({ mode: "push", url: "http://127.0.0.1:3101/x", events: ["message.created"], description: null }),
    );
    expect(e.failure).toMatchObject({ kind: "http", status: 422, code: "validation_failed" });
  });

  test("a member key gets 403 forbidden on createWebhook", async () => {
    server.apiKeyRole = "member";
    const e = await failure(
      gateway.createWebhook({ mode: "push", url: "https://mt.example.com/x", events: ["message.created"], description: null }),
    );
    expect(e.failure).toMatchObject({ kind: "http", status: 403, code: "forbidden" });
  });

  test("deleteWebhook sends DELETE and maps 204 and 404", async () => {
    const hook = await gateway.createWebhook({
      mode: "push",
      url: "https://mt.example.com/x",
      events: ["message.created"],
      description: null,
    });
    expect(await gateway.deleteWebhook(hook.id)).toEqual({ deleted: true });
    expect(server.requests.at(-1)).toMatchObject({ method: "DELETE", path: `/v1/webhooks/${hook.id}` });
    expect(await gateway.deleteWebhook(hook.id)).toEqual({ deleted: false });
  });

  test("deleteWebhook rethrows a 500", async () => {
    server.scriptNext("DELETE /v1/webhooks", { kind: "status", status: 500 });
    const e = await failure(gateway.deleteWebhook("00000000-0000-4000-8000-000000000001"));
    expect(e.failure).toMatchObject({ kind: "http", status: 500 });
  });

  test("listWebhookDeliveries passes the limit and maps the backend-uatis delivery shape", async () => {
    const hook = await gateway.createWebhook({
      mode: "push",
      url: "https://mt.example.com/x",
      events: ["message.created"],
      description: null,
    });
    server.recordDelivery(hook.id, { status: "failed", http_status: 401, event_type: "message.created" });
    server.recordDelivery(hook.id, { status: "delivered", http_status: 200, event_type: "message.updated" });
    const attempts = await gateway.listWebhookDeliveries(hook.id, { limit: 5 });
    expect(server.requests.at(-1)?.query).toEqual({ limit: "5" });
    expect(attempts.map((a) => [a.eventType, a.status, a.httpStatus])).toEqual([
      ["message.updated", "delivered", 200],
      ["message.created", "failed", 401],
    ]);
    expect(attempts[0]?.createdAt).toBeInstanceOf(Date);
  });

  // covers FR-174 (ADR-023): the event feed.
  describe("listWebhookEvents", () => {
    async function pullHook() {
      return gateway.createWebhook({
        mode: "pull",
        url: null,
        events: ["message.created", "message.updated"],
        description: null,
      });
    }

    test("reads GET /v1/webhooks/{id}/events with after and limit, oldest first", async () => {
      const hook = await pullHook();
      const first = server.injectInbound("5511988887777", "um");
      server.injectInbound("5511988887777", "dois");
      const page = await gateway.listWebhookEvents(hook.id, { after: null, limit: 1 });
      expect(server.requests.at(-1)).toMatchObject({ method: "GET", path: `/v1/webhooks/${hook.id}/events`, query: { limit: "1" } });
      expect(page.events).toHaveLength(1);
      expect(page.nextCursor).toBe(page.events[0]?.cursor ?? "missing");
      const event = page.events[0]?.event as { type: string; organization_id: string; data: { message: { id: string } } };
      expect(event.type).toBe("message.created");
      expect(event.organization_id).toBe(server.organizationId);
      expect(event.data.message.id).toBe(first.id);
      const next = await gateway.listWebhookEvents(hook.id, { after: page.events[0]?.cursor ?? null, limit: 50 });
      expect(server.requests.at(-1)?.query.after).toBe(page.events[0]?.cursor);
      expect(next.events.map((e) => (e.event as { data: { message: { content: { text: string } } } }).data.message.content.text)).toEqual(["dois"]);
      expect(next.nextCursor).toBe(next.events[0]?.cursor ?? "missing");
      const empty = await gateway.listWebhookEvents(hook.id, { after: next.nextCursor, limit: 50 });
      expect(empty).toEqual({ events: [], nextCursor: next.nextCursor });
    });

    test("a foreign cursor is a 400 validation_failed", async () => {
      const hook = await pullHook();
      const e = await failure(gateway.listWebhookEvents(hook.id, { after: "not-a-cursor" }));
      expect(e.failure).toMatchObject({ kind: "http", status: 400, code: "validation_failed" });
    });

    test("getWebhook reads GET /v1/webhooks/{id} with the mode, and 404 is null", async () => {
      const hook = await pullHook();
      expect(await gateway.getWebhook(hook.id)).toEqual({ id: hook.id, mode: "pull", url: null, status: "active" });
      expect(server.requests.at(-1)).toMatchObject({ method: "GET", path: `/v1/webhooks/${hook.id}` });
      expect(await gateway.getWebhook("00000000-0000-4000-8000-000000000009")).toBeNull();
    });

    test("a feed event equals the push body byte for byte, apart from the cursor", async () => {
      const hook = await pullHook();
      server.injectInbound("5511988887777", "igual");
      const page = await gateway.listWebhookEvents(hook.id, { after: null });
      const pushed = server.pushBodies.at(-1);
      expect(JSON.stringify(page.events[0]?.event)).toBe(pushed ?? "missing");
    });

    test("410 cursor_expired is a GatewayError with that status and code", async () => {
      const hook = await pullHook();
      server.scriptNext(`GET /v1/webhooks/${hook.id}/events`, { kind: "status", status: 410, code: "cursor_expired" });
      const e = await failure(gateway.listWebhookEvents(hook.id, { after: "old" }));
      expect(e.failure).toMatchObject({ kind: "http", status: 410, code: "cursor_expired" });
    });

    test("an older backend-uatis without the feed answers 404", async () => {
      server.feedSupported = false;
      const hook = await pullHook();
      const e = await failure(gateway.listWebhookEvents(hook.id, { after: null }));
      expect(e.failure).toMatchObject({ kind: "http", status: 404 });
    });
  });
});
