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
