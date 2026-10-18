// covers FR-146, FR-147, FR-148, FR-152, ADR-007, ADR-009 (end to end over pgmq with a local receiver)
// Needs the local stack (`bun run dev:stack`) or TEST_DATABASE_URL.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeGateway, FixedClock, ScriptedAssistantModel, verifyMarmitopSignature } from "@mt/core";
import { type Db, QUEUES } from "@mt/db";
import { createTestDb, type RestaurantFixture, seedRestaurant, truncateQueues } from "@mt/db/test-harness";
import {
  connectWhatsApp,
  createOrder,
  type GatewayFactory,
  rotateWebhookSecret,
  type ServiceDeps,
  saveWebhookEndpoint,
} from "@mt/http";
import { createTestServiceDeps, userCtx } from "@mt/http/testing";

import { PgmqQueueClient } from "./framework/pgmq-client";
import { QueueWorker } from "./framework/worker";
import { createOutboundMessageHandler } from "./handlers/outbound-message";
import { buildRegistry } from "./registry";
import { DbOutboundStore } from "./stores/outbound-store";

const NOW = new Date("2026-10-13T15:00:00Z");
const quiet = { info() {}, warn() {}, error() {} };

let db: Db;
let deps: ServiceDeps;
let a: RestaurantFixture;
let secret: string;
let server: ReturnType<typeof Bun.serve>;
let answer = 200;
const received: { headers: Headers; body: string }[] = [];

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      received.push({ headers: req.headers, body: await req.text() });
      return new Response(null, { status: answer });
    },
  });
  db = await createTestDb();
  const gateway = new FakeGateway({ clock: new FixedClock(NOW) });
  const gateways: GatewayFactory = {
    whatsapp: () => gateway,
    invoices: () => {
      throw new Error("unused");
    },
  };
  // createTestServiceDeps sets allowPrivateHosts, so the receiver may be 127.0.0.1.
  deps = createTestServiceDeps(db, { clock: new FixedClock(NOW), gateways });
  a = await seedRestaurant(db, "wh-worker-a");
  const admin = userCtx(a.restaurantId, a.adminId, "admin");
  await saveWebhookEndpoint(deps, admin, {
    url: `http://127.0.0.1:${server.port}/hook`,
    events: ["order.created", "order.status_changed", "message.received", "invoice.updated"],
    enabled: true,
  });
  secret = (await rotateWebhookSecret(deps, admin, undefined)).secret;
  await connectWhatsApp(deps, admin, {
    baseUrl: "http://127.0.0.1:4010",
    apiKey: "obk_test_worker",
    webhookSecret: "whsec_worker",
    phoneNumberId: "pn-worker",
  });
});

beforeEach(async () => {
  await truncateQueues(db);
  await db`delete from public.webhook_deliveries`;
  received.length = 0;
  answer = 200;
});

afterAll(async () => {
  server.stop(true);
  await db.end();
});

const worker = () =>
  new QueueWorker({
    client: new PgmqQueueClient(db),
    registry: buildRegistry(deps, quiet, new ScriptedAssistantModel([])),
    log: quiet,
  });

async function newOrder() {
  return createOrder(deps, userCtx(a.restaurantId, a.attendantId, "attendant"), {
    customerId: a.customerId,
    items: [{ menuItemId: a.menuItemId, sizeId: a.menuItemSizeId, qty: 1 }],
    fulfillment: "pickup",
    paymentMethod: "pix",
    source: "counter",
  });
}

describe("mt_webhook_deliveries end to end", () => {
  test("order.created is signed, delivered, and recorded once (FR-147, FR-148)", async () => {
    const order = await newOrder();
    expect(await worker().tick(QUEUES.webhookDeliveries)).toBe(1);
    expect(received).toHaveLength(1);
    const got = received[0];
    expect(JSON.parse(got?.body ?? "{}")).toMatchObject({ type: "order.created", data: { order: { id: order.id } } });
    expect(
      verifyMarmitopSignature({ headers: got?.headers ?? new Headers(), rawBody: got?.body ?? "", secret, now: NOW })
        .ok,
    ).toBe(true);
    const [row] = await db<{ id: string; status: string; attempts: number; last_status_code: number }[]>`
      select id, status, attempts, last_status_code from public.webhook_deliveries`;
    expect(row).toMatchObject({ status: "delivered", attempts: 1, last_status_code: 200 });
    expect(got?.headers.get("X-Marmitop-Delivery")).toBe(row?.id);
    const attempts = await db`select outcome from public.job_attempts where subject_id = ${row?.id ?? ""}`;
    expect([...attempts]).toEqual([{ outcome: "ok" }]);
  });

  test("a 500 leaves the delivery failed with next_attempt_at and a delayed retry job", async () => {
    answer = 500;
    await newOrder();
    await worker().tick(QUEUES.webhookDeliveries);
    const [row] = await db<{ status: string; attempts: number; last_error: string; next_attempt_at: Date }[]>`
      select status, attempts, last_error, next_attempt_at from public.webhook_deliveries`;
    expect(row).toMatchObject({ status: "failed", attempts: 1, last_error: "http_500" });
    expect(row?.next_attempt_at.getTime()).toBe(NOW.getTime() + 60_000);
    const queued = await db<{ message: { attempt?: number } }[]>`select message from pgmq.q_mt_webhook_deliveries`;
    expect(queued.map((q) => q.message.attempt)).toEqual([2]);
  });

  test("the sweep does not double-enqueue a delivery whose job is queued", async () => {
    await newOrder();
    const [r] = await db<{ n: number }[]>`select mt.requeue_due_deliveries() as n`;
    expect(r?.n).toBe(0);
  });
});

describe("usage (FR-152)", () => {
  test("a sent outbound message writes one message.sent usage row", async () => {
    const [m] = await db<{ id: string }[]>`
      insert into public.messages (restaurant_id, conversation_id, direction, body, status)
      values (${a.restaurantId}, ${a.conversationId}, 'out', 'Olá', 'pending') returning id`;
    const handler = createOutboundMessageHandler({
      store: new DbOutboundStore(deps),
      gatewayFor: () => new FakeGateway({ clock: new FixedClock(NOW) }),
    });
    await handler.run({
      queue: QUEUES.outboundMessages,
      msgId: 1,
      payload: { v: 1, restaurantId: a.restaurantId, messageId: m?.id ?? "" },
      attempt: 1,
      readCount: 1,
      signal: new AbortController().signal,
    });
    const usage = await db`select kind from public.usage_events where ref_id = ${m?.id ?? ""}`;
    expect([...usage]).toEqual([{ kind: "message.sent" }]);
  });
});
