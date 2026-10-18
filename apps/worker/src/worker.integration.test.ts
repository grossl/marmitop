// covers FR-101, FR-107, FR-108, FR-117, NFR-022, NFR-032, ADR-007, ADR-017 #4
// Needs the local stack (`bun run dev:stack`) or TEST_DATABASE_URL.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeGateway, FixedClock, GatewayError, ScriptedAssistantModel } from "@mt/core";
import { type Db, QUEUES, sendJob } from "@mt/db";
import { asService, createTestDb, type RestaurantFixture, seedRestaurant, truncateQueues } from "@mt/db/test-harness";
import { connectWhatsApp, enableUatisWebhook, type GatewayFactory, type ServiceDeps } from "@mt/http";
import { createTestServiceDeps, userCtx } from "@mt/http/testing";

import { PgmqQueueClient } from "./framework/pgmq-client";
import { QueueWorker } from "./framework/worker";
import { createOutboundMessageHandler } from "./handlers/outbound-message";
import { createUatisFeedHandler } from "./handlers/uatis-feed";
import { createWhatsAppReconcileHandler } from "./handlers/whatsapp-reconcile";
import { buildRegistry } from "./registry";
import { DbFeedStore } from "./stores/feed-store";
import { DbOutboundStore } from "./stores/outbound-store";
import { DbReconcileStore } from "./stores/reconcile-store";

const NOW = new Date("2026-10-13T15:00:00Z");
const quiet = { info() {}, warn() {}, error() {} };

let db: Db;
let gateway: FakeGateway;
let deps: ServiceDeps;
let a: RestaurantFixture;

beforeAll(async () => {
  db = await createTestDb();
  gateway = new FakeGateway({ clock: new FixedClock(NOW) });
  const gateways: GatewayFactory = {
    whatsapp: () => gateway,
    invoices: () => {
      throw new Error("not in P5");
    },
  };
  deps = createTestServiceDeps(db, { clock: new FixedClock(NOW), gateways });
  a = await seedRestaurant(db, "wk-a");
  await connectWhatsApp(deps, userCtx(a.restaurantId, a.adminId, "admin"), {
    baseUrl: "http://127.0.0.1:4010",
    apiKey: "obk_test_worker",
    webhookSecret: "whsec_worker",
    phoneNumberId: "pn-worker",
  });
});

beforeEach(async () => {
  await truncateQueues(db);
});

afterAll(async () => {
  await db.end();
});

async function pendingMessage(body = "Olá!"): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    insert into public.messages (restaurant_id, conversation_id, direction, body, status)
    values (${a.restaurantId}, ${a.conversationId}, 'out', ${body}, 'pending') returning id`;
  if (!row) throw new Error("insert failed");
  return row.id;
}

async function message(id: string) {
  const [row] = await db<
    { status: string; external_id: string | null; error_code: string | null; send_claimed_at: Date | null }[]
  >`select status, external_id, error_code, send_claimed_at from public.messages where id = ${id}`;
  return row;
}

const job = (messageId: string) => ({ v: 1, restaurantId: a.restaurantId, messageId });
const ctx = (messageId: string) => ({
  queue: QUEUES.outboundMessages,
  msgId: 1,
  payload: job(messageId) as { v: 1; restaurantId: string; messageId: string },
  attempt: 1,
  readCount: 1,
  signal: new AbortController().signal,
});

describe("DbOutboundStore with the send handler", () => {
  const handler = () => createOutboundMessageHandler({ store: new DbOutboundStore(deps), gatewayFor: () => gateway });

  test("a pending message gets an external id and sent; a second run sends nothing (FR-101)", async () => {
    const id = await pendingMessage();
    const before = gateway.sentTexts.length;
    expect(await handler().run(ctx(id))).toEqual({ kind: "ok" });
    const row = await message(id);
    expect(row?.status).toBe("sent");
    expect(row?.external_id).toMatch(/^fake-msg-/);
    expect(await handler().run(ctx(id))).toEqual({ kind: "ok" });
    expect(gateway.sentTexts.length).toBe(before + 1);
  });

  test("a claimed message is failed ambiguous without a call (ADR-017 #4)", async () => {
    const id = await pendingMessage();
    await db`update public.messages set send_claimed_at = now() where id = ${id}`;
    const before = gateway.calls.length;
    expect(await handler().run(ctx(id))).toEqual({ kind: "fail", errorCode: "ambiguous" });
    expect((await message(id))?.status).toBe("failed");
    expect(gateway.calls.length).toBe(before);
  });

  test("a timeout leaves the message failed ambiguous (FR-108)", async () => {
    const id = await pendingMessage();
    gateway.failNextSend(GatewayError.timeout());
    await handler().run(ctx(id));
    expect(await message(id)).toMatchObject({ status: "failed", error_code: "ambiguous" });
  });

  test("a connection error keeps the message pending and releases the claim", async () => {
    const id = await pendingMessage();
    gateway.failNextSend(GatewayError.connection());
    expect((await handler().run(ctx(id))).kind).toBe("retry");
    expect(await message(id)).toMatchObject({ status: "pending", send_claimed_at: null });
  });

  test("outside_service_window from backend-uatis is stored on the message (FR-117)", async () => {
    const id = await pendingMessage();
    gateway.failNextSend(GatewayError.http(422, "outside_service_window"));
    await handler().run(ctx(id));
    expect(await message(id)).toMatchObject({ status: "failed", error_code: "outside_service_window" });
  });
});

describe("QueueWorker over pgmq", () => {
  test("a job is consumed: one ok job_attempts row, the queue is empty, the archive holds it", async () => {
    const id = await pendingMessage();
    await asService(db, { restaurantId: a.restaurantId, actorType: "system" }, (tx) =>
      sendJob(tx, QUEUES.outboundMessages, job(id)),
    );
    const worker = new QueueWorker({
      client: new PgmqQueueClient(db),
      registry: buildRegistry(deps, quiet, new ScriptedAssistantModel([])),
      log: quiet,
    });
    expect(await worker.tick(QUEUES.outboundMessages)).toBe(1);
    const attempts = await db<{ outcome: string; attempt_no: number; subject_id: string }[]>`
      select outcome, attempt_no, subject_id from public.job_attempts where subject_id = ${id}`;
    expect([...attempts]).toEqual([{ outcome: "ok", attempt_no: 1, subject_id: id }]);
    const [q] = await db<{ n: number }[]>`select count(*)::int as n from pgmq.q_mt_outbound_messages`;
    const [arch] = await db<{ n: number }[]>`select count(*)::int as n from pgmq.a_mt_outbound_messages`;
    expect(q?.n).toBe(0);
    expect(arch?.n).toBe(1);
  });

  test("a transient failure re-enqueues with attempt 2 and a 60 s delay (FR-108)", async () => {
    const id = await pendingMessage();
    await asService(db, { restaurantId: a.restaurantId, actorType: "system" }, (tx) =>
      sendJob(tx, QUEUES.outboundMessages, job(id)),
    );
    gateway.failNextSend(GatewayError.connection());
    const worker = new QueueWorker({
      client: new PgmqQueueClient(db),
      registry: buildRegistry(deps, quiet, new ScriptedAssistantModel([])),
      log: quiet,
    });
    await worker.tick(QUEUES.outboundMessages);
    const [q] = await db<{ message: { attempt: number }; delay: number }[]>`
      select message, extract(epoch from (vt - enqueued_at))::int as delay from pgmq.q_mt_outbound_messages`;
    expect(q?.message.attempt).toBe(2);
    expect(q?.delay).toBeGreaterThanOrEqual(59);
    const [att] = await db<{ outcome: string; error_code: string }[]>`
      select outcome, error_code from public.job_attempts where subject_id = ${id}`;
    expect(att).toEqual({ outcome: "transient_error", error_code: "connection_error" });
  });
});

describe("DbReconcileStore with the poll handler (FR-107)", () => {
  test("a message missed by the webhook appears after one poll and the cursor advances", async () => {
    await db`update public.integrations_whatsapp set last_sync_cursor = ${new Date(NOW.getTime() - 120_000)}
             where restaurant_id = ${a.restaurantId}`;
    const m = gateway.simulateInbound({
      from: "+5511955554444",
      body: "Perdida no webhook",
      at: new Date(NOW.getTime() - 30_000),
    });
    const handler = createWhatsAppReconcileHandler({
      store: new DbReconcileStore(deps),
      gatewayFor: () => gateway,
      clock: deps.clock,
      log: quiet,
    });
    const run = () =>
      handler.run({
        queue: QUEUES.sync,
        msgId: 1,
        payload: { v: 1, restaurantId: a.restaurantId, op: "whatsapp_reconcile" },
        attempt: 1,
        readCount: 1,
        signal: new AbortController().signal,
      });
    expect(await run()).toEqual({ kind: "ok" });
    expect(await run()).toEqual({ kind: "ok" });
    const rows = await db<{ body: string }[]>`
      select body from public.messages where restaurant_id = ${a.restaurantId} and external_id = ${m.externalId}`;
    expect([...rows]).toEqual([{ body: "Perdida no webhook" }]);
    const [w] = await db<{ last_sync_cursor: Date }[]>`
      select last_sync_cursor from public.integrations_whatsapp where restaurant_id = ${a.restaurantId}`;
    expect(w?.last_sync_cursor.toISOString()).toBe(m.createdAt.toISOString());
  });

  test("mt.enqueue_whatsapp_sync enqueues one job per connected restaurant, not twice", async () => {
    const [first] = await db<{ n: number }[]>`select mt.enqueue_whatsapp_sync() as n`;
    const [second] = await db<{ n: number }[]>`select mt.enqueue_whatsapp_sync() as n`;
    expect(first?.n).toBeGreaterThanOrEqual(1);
    expect(second?.n).toBe(0);
  });
});

// covers FR-174, FR-176 (ADR-023): the event feed against the database.
describe("DbFeedStore with the feed handler", () => {
  const run = () =>
    createUatisFeedHandler({
      store: new DbFeedStore(deps),
      reconcileStore: new DbReconcileStore(deps),
      gatewayFor: () => gateway,
      clock: deps.clock,
      log: quiet,
    }).run({
      queue: QUEUES.sync,
      msgId: 1,
      payload: { v: 1, restaurantId: a.restaurantId, op: "uatis_feed_pull" },
      attempt: 1,
      readCount: 1,
      signal: new AbortController().signal,
    });

  test("a pull webhook's inbound event lands in messages once and the cursor is stored", async () => {
    const enabled = await enableUatisWebhook(deps, userCtx(a.restaurantId, a.adminId, "admin"), undefined);
    expect(enabled).toMatchObject({ ok: true, mode: "pull" });
    if (!enabled.ok) return;
    const m = gateway.simulateInbound({
      from: "+5511955553333",
      body: "Oi pelo feed",
      at: new Date(NOW.getTime() - 5_000),
    });
    expect(await run()).toEqual({ kind: "ok" });
    const feed = gateway.feeds.get(enabled.webhookId) ?? [];
    const [w] = await db<{ uatis_feed_cursor: string; last_synced_at: Date }[]>`
      select uatis_feed_cursor, last_synced_at from public.integrations_whatsapp where restaurant_id = ${a.restaurantId}`;
    expect(w?.uatis_feed_cursor).toBe(feed.at(-1)?.cursor ?? "missing");
    expect(w?.last_synced_at).toEqual(NOW);

    // Reading from the start again applies nothing twice (receipts).
    await db`update public.integrations_whatsapp set uatis_feed_cursor = null where restaurant_id = ${a.restaurantId}`;
    expect(await run()).toEqual({ kind: "ok" });
    const rows = await db<{ body: string }[]>`
      select body from public.messages where restaurant_id = ${a.restaurantId} and external_id = ${m.externalId}`;
    expect([...rows]).toEqual([{ body: "Oi pelo feed" }]);
    // The fixture seeds one push receipt; the feed adds one pull receipt per event.
    const receipts = await db<{ source: string }[]>`
      select source from public.uatis_event_receipts where restaurant_id = ${a.restaurantId} and source = 'pull'`;
    expect(receipts.length).toBe(feed.length);
  });

  test("a status update read from the feed moves an outbound message to read", async () => {
    const id = await pendingMessage("Seu pedido saiu");
    await createOutboundMessageHandler({ store: new DbOutboundStore(deps), gatewayFor: () => gateway }).run(ctx(id));
    const sent = await message(id);
    gateway.setMessageStatus(sent?.external_id ?? "", "read");
    expect(await run()).toEqual({ kind: "ok" });
    expect((await message(id))?.status).toBe("read");
  });

  test("the timer function enqueues a feed pull for the restaurant in pull mode", async () => {
    await db`update public.integrations_whatsapp set last_synced_at = now() - interval '10 seconds'
             where restaurant_id = ${a.restaurantId}`;
    const [row] = await db<{ n: number }[]>`select mt.enqueue_uatis_feed_pulls(3) as n`;
    expect(row?.n).toBeGreaterThanOrEqual(1);
    const jobs = await db<{ op: string }[]>`
      select message ->> 'op' as op from pgmq.q_mt_sync where message ->> 'restaurantId' = ${a.restaurantId}`;
    expect(jobs.map((j) => j.op)).toEqual(["uatis_feed_pull"]);
  });
});
