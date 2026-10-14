// covers FR-146, FR-147, FR-148, ADR-007 (retry schedule), ADR-009, 06.api-spec.md "Outbound webhooks"
import { beforeEach, describe, expect, test } from "bun:test";
import { FakeWebhookSender, FixedClock, GatewayError, verifyMarmitopSignature } from "@mt/core";
import { QUEUES } from "@mt/db";

import type { JobContext } from "../framework/types";
import {
  createWebhookDeliveryHandler,
  type DeliveryAttempt,
  type LoadedDelivery,
  type WebhookDeliveryStore,
} from "./webhook-delivery";

const R = "3f6c1a0e-7a3b-4b1e-9c53-1f3f6d0f6a11";
const D = "0d9e2b34-5c11-4e7a-8d2f-6a5b9c0e1f22";
const NOW = new Date("2026-10-13T12:00:00Z");
const BODY = `{"id":"${D}","type":"order.created","created_at":"2026-10-13T11:59:59.000Z","restaurant_id":"${R}","data":{}}`;

class MemoryDeliveryStore implements WebhookDeliveryStore {
  row: LoadedDelivery | null = {
    status: "pending",
    attempts: 0,
    event: "order.created",
    body: BODY,
    endpoint: { url: "https://hooks.example.com/in", enabled: true, secret: "whsec_x" },
  };
  attempts: DeliveryAttempt[] = [];
  exhausted: string[] = [];
  async load() {
    return this.row;
  }
  async recordAttempt(_r: string, _d: string, attempt: DeliveryAttempt) {
    this.attempts.push(attempt);
    if (this.row) this.row = { ...this.row, status: attempt.status, attempts: attempt.attemptNo };
  }
  async markExhausted(_r: string, _d: string, errorCode: string) {
    this.exhausted.push(errorCode);
  }
}

let store: MemoryDeliveryStore;
let sender: FakeWebhookSender;
const clock = new FixedClock(NOW);
const handler = () => createWebhookDeliveryHandler({ store, sender, clock });
const ctx = (attempt = 1): JobContext<{ v: 1; restaurantId: string; deliveryId: string }> => ({
  queue: QUEUES.webhookDeliveries,
  msgId: 1,
  payload: { v: 1, restaurantId: R, deliveryId: D },
  attempt,
  readCount: 1,
  signal: new AbortController().signal,
});

beforeEach(() => {
  store = new MemoryDeliveryStore();
  sender = new FakeWebhookSender({ clock });
});

describe("webhook delivery handler", () => {
  test("is registered on mt_webhook_deliveries with subject webhook_delivery", () => {
    const h = handler();
    expect(h.queue).toBe("mt_webhook_deliveries");
    expect(h.subjectType).toBe("webhook_delivery");
    expect(h.subjectId(ctx().payload)).toBe(D);
  });

  test("a 2xx marks the delivery delivered and records the attempt", async () => {
    sender.scriptNext({ statusCode: 202 });
    const outcome = await handler().run(ctx());
    expect(outcome).toEqual({ kind: "ok", httpStatus: 202 });
    expect(store.attempts).toEqual([
      { attemptNo: 1, status: "delivered", statusCode: 202, error: null, nextAttemptAt: null, at: NOW },
    ]);
  });

  test("sends the stored body byte for byte, signed with the endpoint secret", async () => {
    await handler().run(ctx());
    const sent = sender.deliveries[0];
    expect(sent?.delivery).toEqual({
      url: "https://hooks.example.com/in",
      secret: "whsec_x",
      event: "order.created",
      deliveryId: D,
      body: BODY,
    });
    const check = verifyMarmitopSignature({ headers: sent?.headers ?? {}, rawBody: BODY, secret: "whsec_x", now: NOW });
    expect(check.ok).toBe(true);
  });

  test("a 500 is failed with next_attempt_at 1 minute later, and the framework retries", async () => {
    sender.scriptNext({ statusCode: 500 });
    const outcome = await handler().run(ctx());
    expect(outcome).toEqual({ kind: "retry", errorCode: "http_500", httpStatus: 500 });
    expect(store.attempts[0]).toEqual({
      attemptNo: 1,
      status: "failed",
      statusCode: 500,
      error: "http_500",
      nextAttemptAt: new Date(NOW.getTime() + 60_000),
      at: NOW,
    });
  });

  test("a 4xx is retried too: anything but 2xx retries (06)", async () => {
    sender.scriptNext({ statusCode: 410 });
    expect((await handler().run(ctx())).kind).toBe("retry");
  });

  test("a timeout or a network error retries", async () => {
    sender.scriptNext({ error: GatewayError.timeout() });
    expect(await handler().run(ctx())).toEqual({ kind: "retry", errorCode: "timeout" });
    sender.scriptNext({ error: GatewayError.connection() });
    expect(await handler().run(ctx())).toEqual({ kind: "retry", errorCode: "connection_error" });
    expect(store.attempts.map((a) => a.attemptNo)).toEqual([1, 2]);
  });

  test("the schedule follows the stored attempt count: 1m, 5m, 30m, 2h, 8h, then exhausted", async () => {
    const delays: number[] = [];
    for (let i = 0; i < 6; i++) {
      sender.scriptNext({ statusCode: 503 });
      const outcome = await handler().run(ctx(i + 1));
      const last = store.attempts[store.attempts.length - 1];
      if (last?.nextAttemptAt) delays.push(last.nextAttemptAt.getTime() - NOW.getTime());
      if (i < 5) expect(outcome.kind).toBe("retry");
      else expect(outcome).toEqual({ kind: "fail", errorCode: "http_503", httpStatus: 503 });
    }
    expect(delays).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 28_800_000]);
    expect(store.attempts.map((a) => a.status)).toEqual([
      "failed",
      "failed",
      "failed",
      "failed",
      "failed",
      "exhausted",
    ]);
  });

  test("a host refused by the SSRF guard is exhausted at once, nothing was sent", async () => {
    sender.scriptNext({ error: GatewayError.refused("host_not_allowed") });
    const outcome = await handler().run(ctx());
    expect(outcome).toEqual({ kind: "fail", errorCode: "host_not_allowed" });
    expect(store.attempts[0]).toMatchObject({ status: "exhausted", error: "host_not_allowed", statusCode: null });
  });

  test("an already delivered or exhausted delivery, or a missing one, is skipped without a send", async () => {
    for (const status of ["delivered", "exhausted"] as const) {
      store.row = { ...(store.row as LoadedDelivery), status };
      expect(await handler().run(ctx())).toEqual({ kind: "ok" });
    }
    store.row = null;
    expect(await handler().run(ctx())).toEqual({ kind: "ok" });
    expect(sender.deliveries).toHaveLength(0);
    expect(store.attempts).toHaveLength(0);
  });

  test("a disabled endpoint is exhausted without a send", async () => {
    store.row = {
      ...(store.row as LoadedDelivery),
      endpoint: { url: "https://x.example", enabled: false, secret: "s" },
    };
    const outcome = await handler().run(ctx());
    expect(outcome).toEqual({ kind: "fail", errorCode: "endpoint_disabled" });
    expect(sender.deliveries).toHaveLength(0);
    expect(store.attempts[0]).toMatchObject({ status: "exhausted", error: "endpoint_disabled" });
  });

  test("onExhausted marks the delivery exhausted", async () => {
    await handler().onExhausted?.(ctx(6), { errorCode: "internal_error" });
    expect(store.exhausted).toEqual(["internal_error"]);
  });
});
