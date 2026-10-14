// covers FR-147, FR-148, NFR-012, 07.security.md "Outbound webhook signing", ADR-009
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { FixedClock, GatewayError, verifyMarmitopSignature } from "@mt/core";
import { webhookSenderContract } from "@mt/core/contracts";

import { createSafeFetch } from "./safe-fetch";
import { SafeFetchWebhookSender } from "./webhook-sender";

const NOW = new Date("2026-10-13T12:00:00Z");
let server: ReturnType<typeof Bun.serve>;
let base: string;
const received: { headers: Headers; body: string }[] = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      received.push({ headers: req.headers, body: await req.text() });
      if (url.pathname === "/fail") return new Response("boom", { status: 500 });
      if (url.pathname === "/redirect") return new Response(null, { status: 302, headers: { location: "/ok" } });
      return new Response("ok", { status: 204 });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server.stop(true));

const sender = (allowPrivateHosts = true) =>
  new SafeFetchWebhookSender({ fetch: createSafeFetch({ allowPrivateHosts }), clock: new FixedClock(NOW) });

const delivery = (path: string) => ({
  url: `${base}${path}`,
  secret: "whsec_test",
  event: "order.created",
  deliveryId: "0d9e2b34-5c11-4e7a-8d2f-6a5b9c0e1f22",
  body: '{"id":"0d9e2b34-5c11-4e7a-8d2f-6a5b9c0e1f22","type":"order.created","data":{}}',
});

describe("SafeFetchWebhookSender", () => {
  test("POSTs the body byte for byte with a verifiable signature and the event headers", async () => {
    received.length = 0;
    const result = await sender().send(delivery("/ok"));
    expect(result.statusCode).toBe(204);
    const got = received[0];
    expect(got?.body).toBe(delivery("/ok").body);
    expect(got?.headers.get("X-Marmitop-Event")).toBe("order.created");
    expect(got?.headers.get("X-Marmitop-Delivery")).toBe(delivery("/ok").deliveryId);
    expect(got?.headers.get("Content-Type")).toBe("application/json");
    expect(got?.headers.get("User-Agent")).toBe("Marmitop-Webhooks/1");
    const check = verifyMarmitopSignature({
      headers: got?.headers ?? new Headers(),
      rawBody: got?.body ?? "",
      secret: "whsec_test",
      now: NOW,
    });
    expect(check).toEqual({ ok: true });
  });

  test("a non-2xx answer resolves with its status (the handler decides)", async () => {
    expect((await sender().send(delivery("/fail"))).statusCode).toBe(500);
  });

  test("a redirect is not followed", async () => {
    received.length = 0;
    const e = await sender()
      .send(delivery("/redirect"))
      .catch((x) => x);
    expect(e).toBeInstanceOf(GatewayError);
    expect(received).toHaveLength(1);
  });

  test("a private host is refused in production mode before anything is sent", async () => {
    received.length = 0;
    const e = await sender(false)
      .send(delivery("/ok"))
      .catch((x) => x);
    expect(e).toBeInstanceOf(GatewayError);
    expect((e as GatewayError).failure).toEqual({ kind: "refused", code: expect.any(String) });
    expect(received).toHaveLength(0);
  });
});

webhookSenderContract("SafeFetchWebhookSender", async () => ({ sender: sender(), url: `${base}/ok` }));
