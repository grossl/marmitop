// covers FR-101, FR-108, FR-117, FR-019, ADR-014, ADR-017 #4 (at-most-once send)
import { beforeEach, describe, expect, test } from "bun:test";
import { FakeGateway, GatewayError } from "@mt/core";
import { QUEUES } from "@mt/db";

import type { JobContext } from "../framework/types";
import { type ClaimResult, createOutboundMessageHandler, type OutboundStore } from "./outbound-message";

const R = "3f6c1a0e-7a3b-4b1e-9c53-1f3f6d0f6a11";
const M = "0d9e2b34-5c11-4e7a-8d2f-6a5b9c0e1f22";
const conn = { baseUrl: "http://uatis.local", apiKey: "obk_test_x", phoneNumberId: "pn-1" };

class MemoryOutboundStore implements OutboundStore {
  claimResult: ClaimResult = {
    kind: "claimed",
    message: { to: "+5511999990000", body: "Olá!", template: null },
    connection: conn,
  };
  claims = 0;
  sent: { externalId: string; status: string }[] = [];
  failed: { code: string; message: string }[] = [];
  released = 0;
  async claim() {
    this.claims++;
    const r = this.claimResult;
    // A second claim of the same message finds it claimed.
    if (r.kind === "claimed") this.claimResult = { kind: "already_claimed" };
    return r;
  }
  async markSent(_r: string, _m: string, externalId: string, status: string) {
    this.sent.push({ externalId, status });
  }
  async markFailed(_r: string, _m: string, code: string, message: string) {
    this.failed.push({ code, message });
  }
  async release() {
    this.released++;
    this.claimResult = {
      kind: "claimed",
      message: { to: "+5511999990000", body: "Olá!", template: null },
      connection: conn,
    };
  }
}

let store: MemoryOutboundStore;
let gateway: FakeGateway;
const ctx = (attempt = 1, readCount = 1): JobContext<{ v: 1; restaurantId: string; messageId: string }> => ({
  queue: QUEUES.outboundMessages,
  msgId: 1,
  payload: { v: 1, restaurantId: R, messageId: M },
  attempt,
  readCount,
  signal: new AbortController().signal,
});

beforeEach(() => {
  store = new MemoryOutboundStore();
  gateway = new FakeGateway();
});

const handler = () => createOutboundMessageHandler({ store, gatewayFor: () => gateway });

describe("mt_outbound_messages handler", () => {
  test("sends a pending text, stores the external id, and sets sent (FR-101)", async () => {
    const out = await handler().run(ctx());
    expect(out).toEqual({ kind: "ok" });
    expect(gateway.sentTexts).toEqual([{ to: "+5511999990000", fromAddress: "pn-1", body: "Olá!" }]);
    expect(store.sent).toEqual([{ externalId: "fake-msg-1", status: "sent" }]);
  });

  test("a message with a template goes out as that template (ADR-014)", async () => {
    store.claimResult = {
      kind: "claimed",
      message: { to: "+5511999990000", body: "Pedido recebido", template: { name: "pedido", language: "pt_BR" } },
      connection: conn,
    };
    await handler().run(ctx());
    expect(gateway.sentTexts).toHaveLength(0);
    expect(gateway.sentTemplates).toEqual([
      { to: "+5511999990000", fromAddress: "pn-1", templateName: "pedido", language: "pt_BR" },
    ]);
  });

  test("a repeated job does not send twice (FR-101)", async () => {
    const h = handler();
    await h.run(ctx());
    store.claimResult = { kind: "skip", reason: "already_sent" };
    expect(await h.run(ctx())).toEqual({ kind: "ok" });
    expect(gateway.sentTexts).toHaveLength(1);
  });

  test("a message already claimed by an earlier read is failed as ambiguous, never re-sent (ADR-017)", async () => {
    store.claimResult = { kind: "already_claimed" };
    const out = await handler().run(ctx(1, 2));
    expect(out).toEqual({ kind: "fail", errorCode: "ambiguous" });
    expect(gateway.sentTexts).toHaveLength(0);
    expect(store.failed[0]?.code).toBe("ambiguous");
  });

  test("no integration is failed whatsapp_not_configured without a call", async () => {
    store.claimResult = { kind: "not_configured" };
    const out = await handler().run(ctx());
    expect(out).toEqual({ kind: "fail", errorCode: "whatsapp_not_configured" });
    expect(gateway.calls).toHaveLength(0);
  });

  test("a timeout after the request left: failed ambiguous, one attempt, no retry (FR-108)", async () => {
    gateway.failNextSend(GatewayError.timeout());
    const out = await handler().run(ctx());
    expect(out).toEqual({ kind: "fail", errorCode: "ambiguous" });
    expect(store.failed[0]?.code).toBe("ambiguous");
    expect(store.released).toBe(0);
  });

  test("a 5xx after the request left: failed ambiguous", async () => {
    gateway.failNextSend(GatewayError.http(502));
    expect(await handler().run(ctx())).toMatchObject({ kind: "fail", errorCode: "ambiguous", httpStatus: 502 });
  });

  test("422 outside_service_window: failed with that code, no retry (FR-117)", async () => {
    gateway.failNextSend(GatewayError.http(422, "outside_service_window"));
    const out = await handler().run(ctx());
    expect(out).toEqual({ kind: "fail", errorCode: "outside_service_window", httpStatus: 422 });
    expect(store.failed[0]).toEqual({ code: "outside_service_window", message: "Fora da janela de 24h." });
  });

  test("a connection error before the request left releases the claim and retries", async () => {
    gateway.failNextSend(GatewayError.connection());
    const out = await handler().run(ctx());
    expect(out).toEqual({ kind: "retry", errorCode: "connection_error" });
    expect(store.released).toBe(1);
    expect(store.failed).toHaveLength(0);
    // The retry claims again and sends.
    expect(await handler().run(ctx(2))).toEqual({ kind: "ok" });
    expect(gateway.sentTexts).toHaveLength(1);
  });

  test("an unexpected error after the claim is failed ambiguous (the send may have happened)", async () => {
    gateway.failNextSend(new Error("boom"));
    const out = await handler().run(ctx());
    expect(out).toEqual({ kind: "fail", errorCode: "ambiguous" });
  });

  test("when the retries run out the message is failed with the last code (FR-108)", async () => {
    const h = handler();
    await h.onExhausted?.(ctx(6), { errorCode: "connection_error" });
    expect(store.failed[0]?.code).toBe("connection_error");
  });

  test("the subject is the message", () => {
    const h = handler();
    expect(h.subjectType).toBe("message");
    expect(h.subjectId({ v: 1, restaurantId: R, messageId: M })).toBe(M);
    expect(h.queue).toBe(QUEUES.outboundMessages);
  });
});
