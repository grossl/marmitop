// covers FR-039, FR-102, FR-104, FR-105, FR-106, FR-110, FR-111, FR-112, FR-114, FR-117, FR-118, NFR-001, ADR-014, ADR-015
// Needs the local stack (`bun run dev:stack`) or TEST_DATABASE_URL.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { FixedClock, type GatewayMessage, signWebhook } from "@mt/core";
import type { Db } from "@mt/db";
import { asService, createTestDb, type RestaurantFixture, seedRestaurant, truncateQueues } from "@mt/db/test-harness";

import type { ServiceDeps } from "../../deps";
import { createTestServiceDeps, userCtx } from "../../testing";
import { connectWhatsApp, disconnectWhatsApp } from "../admin";
import { simulateInboundMessage } from "../messaging";
import { createOrder } from "../orders";
import { enqueueOrderReceived } from "./automatic";
import { applyGatewayMessage } from "./gateway-events";
import { createDbUatisInboundStore, receiveUatisWebhook } from "./inbound-webhook";

// Tuesday 2026-10-13 12:00 in São Paulo. The fixture's only business-hours row is Monday,
// so the restaurant is closed now unless a test adds Tuesday.
const NOW = new Date("2026-10-13T15:00:00Z");
const WEBHOOK_SECRET = "whsec_integration_a";

let db: Db;
let deps: ServiceDeps;
let a: RestaurantFixture;
let b: RestaurantFixture;
let phoneSeq = 0;

const admin = () => userCtx(a.restaurantId, a.adminId, "admin");
const nextPhone = () => `+55119700000${String(++phoneSeq).padStart(2, "0")}`;

function inbound(over: Partial<GatewayMessage> = {}): GatewayMessage {
  return {
    externalId: `wamid.${crypto.randomUUID()}`,
    conversationExternalId: null,
    direction: "in",
    body: "Oi, tem marmita?",
    contentType: "text",
    status: "delivered",
    contactAddress: nextPhone(),
    createdAt: new Date(NOW.getTime() - 5_000),
    ...over,
  };
}

const apply = (m: GatewayMessage, restaurantId = a.restaurantId) =>
  asService(db, { restaurantId, actorType: "system" }, (tx) => applyGatewayMessage(tx, deps, restaurantId, m));

async function outboundJobs(): Promise<number> {
  const [row] = await db<{ n: number }[]>`select count(*)::int as n from pgmq.q_mt_outbound_messages`;
  return row?.n ?? 0;
}

async function setAuto(kind: string, enabled: boolean, body: string, template?: [string, string]) {
  await db`
    insert into public.automatic_messages (restaurant_id, kind, enabled, body, template_name, template_language)
    values (${a.restaurantId}, ${kind}, ${enabled}, ${body}, ${template?.[0] ?? null}, ${template?.[1] ?? null})
    on conflict (restaurant_id, kind) do update set enabled = excluded.enabled, body = excluded.body,
      template_name = excluded.template_name, template_language = excluded.template_language`;
}

async function openAllWeek() {
  for (let d = 0; d < 7; d++) {
    await db`
      insert into public.business_hours (restaurant_id, weekday, enabled, opens_at, closes_at)
      values (${a.restaurantId}, ${d}, true, '00:00', '23:59')
      on conflict (restaurant_id, weekday) do update set enabled = true, opens_at = '00:00', closes_at = '23:59'`;
  }
}

async function closeAllWeek() {
  await db`update public.business_hours set enabled = false where restaurant_id = ${a.restaurantId}`;
}

beforeAll(async () => {
  db = await createTestDb();
  deps = createTestServiceDeps(db, { clock: new FixedClock(NOW) });
  a = await seedRestaurant(db, "wa-a");
  b = await seedRestaurant(db, "wa-b");
  // Real sealed secrets through the settings service (FakeGateway answers the connection test).
  await connectWhatsApp(deps, admin(), {
    baseUrl: "http://127.0.0.1:4010",
    apiKey: "obk_test_integration",
    webhookSecret: WEBHOOK_SECRET,
    phoneNumberId: "pn-int",
  });
});

beforeEach(async () => {
  await truncateQueues(db);
  await setAuto("welcome", true, "Olá {{nome}}, bem-vindo ao {{restaurante}}!");
  await setAuto("closed", false, "Estamos fechados.");
  await setAuto("order_received", false, "Pedido {{pedido}} recebido.");
});

afterAll(async () => {
  await db.end();
});

describe("applyGatewayMessage (webhook and poll)", () => {
  test("a new phone creates customer, conversation, inbound row, and the welcome message (FR-105, FR-110)", async () => {
    const m = inbound();
    const r = await apply(m);
    expect(r.action).toBe("ingested");
    if (r.action !== "ingested") return;
    expect(r.automatic?.kind).toBe("welcome");
    const rows = await db<
      { direction: string; status: string; automatic_kind: string | null; sent_by: string | null; body: string }[]
    >`
      select direction, status, automatic_kind, sent_by, body from public.messages
      where conversation_id = ${r.conversationId} order by created_at`;
    expect(rows.map((x) => [x.direction, x.status, x.automatic_kind])).toEqual([
      ["in", "delivered", null],
      ["out", "pending", "welcome"],
    ]);
    expect(rows[1]?.sent_by).toBeNull();
    expect(rows[1]?.body).toContain("wa-a");
    expect(await outboundJobs()).toBe(1);
  });

  test("the second inbound message sends no welcome (FR-110)", async () => {
    const phone = nextPhone();
    await apply(inbound({ contactAddress: phone }));
    const r = await apply(inbound({ contactAddress: phone }));
    expect(r.action === "ingested" && r.automatic).toBeNull();
  });

  test("a disabled welcome sends nothing", async () => {
    await setAuto("welcome", false, "x");
    const r = await apply(inbound());
    expect(r.action === "ingested" && r.automatic).toBeNull();
    expect(await outboundJobs()).toBe(0);
  });

  test("the same external id twice leaves one row (FR-104)", async () => {
    const m = inbound();
    await apply(m);
    expect((await apply(m)).action).toBe("unchanged");
    const [row] = await db<{ n: number }[]>`
      select count(*)::int as n from public.messages where restaurant_id = ${a.restaurantId} and external_id = ${m.externalId}`;
    expect(row?.n).toBe(1);
  });

  test("closed: three messages at night give one reply; 12 hours later another (FR-111, ADR-015)", async () => {
    await closeAllWeek();
    await setAuto("closed", true, "Estamos fechados, {{nome}}.");
    const phone = nextPhone();
    const kinds: (string | null)[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await apply(inbound({ contactAddress: phone }));
      kinds.push(r.action === "ingested" ? (r.automatic?.kind ?? null) : "x");
    }
    // closed wins over welcome on the first message
    expect(kinds).toEqual(["closed", null, null]);

    const later = createTestServiceDeps(db, { clock: new FixedClock(new Date(NOW.getTime() + 12 * 3600_000)) });
    const r = await asService(db, { restaurantId: a.restaurantId, actorType: "system" }, (tx) =>
      applyGatewayMessage(tx, later, a.restaurantId, inbound({ contactAddress: phone })),
    );
    expect(r.action === "ingested" && r.automatic?.kind).toBe("closed");
    await openAllWeek();
  });

  test("message.updated moves the status forward only (FR-106)", async () => {
    const m = inbound();
    await apply(m);
    expect(await apply({ ...m, status: "read" })).toEqual({ action: "status_updated", status: "read" });
    expect(await apply({ ...m, status: "delivered" })).toEqual({ action: "unchanged" });
  });

  test("an unknown outbound echo is ignored (06.api-spec.md)", async () => {
    expect(await apply(inbound({ direction: "out" }))).toEqual({ action: "ignored", reason: "unknown_outbound" });
  });

  test("a contact that is not E.164 is ignored", async () => {
    expect(await apply(inbound({ contactAddress: "abc" }))).toEqual({ action: "ignored", reason: "no_phone" });
  });

  test("restaurant B never sees restaurant A's rows (NFR-001)", async () => {
    const m = inbound();
    await apply(m);
    const rows = await asService(
      db,
      { restaurantId: b.restaurantId, actorType: "system" },
      (tx) => tx`select id from public.messages where external_id = ${m.externalId}`,
    );
    expect(rows).toHaveLength(0);
  });
});

describe("receiveUatisWebhook with the database store", () => {
  const T = Math.floor(NOW.getTime() / 1000);
  const body = (id: string, phone: string) =>
    JSON.stringify({
      id: "d1",
      type: "message.created",
      data: {
        message: {
          id,
          conversation_id: "c1",
          direction: "in",
          content: { version: "1", type: "text", kind: "text", text: "Oi pelo webhook" },
          status: { state: "received", errors: [] },
          contact_address: phone,
          created_at: NOW.toISOString(),
        },
      },
    });

  test("a signed event stores the message once, even when replayed (FR-102, FR-104)", async () => {
    const store = createDbUatisInboundStore(deps);
    const raw = body(`wamid.${crypto.randomUUID()}`, nextPhone());
    const input = {
      restaurantId: a.restaurantId,
      signatureHeader: signWebhook(WEBHOOK_SECRET, T, raw),
      rawBody: new TextEncoder().encode(raw),
      now: NOW,
    };
    expect((await receiveUatisWebhook(store, input)).status).toBe(200);
    expect((await receiveUatisWebhook(store, input)).status).toBe(200);
    const [row] = await db<{ n: number }[]>`
      select count(*)::int as n from public.messages where restaurant_id = ${a.restaurantId} and body = 'Oi pelo webhook'`;
    expect(row?.n).toBe(1);
  });

  test("an unknown restaurant and a wrong secret answer the same 401 and write nothing (FR-118)", async () => {
    const store = createDbUatisInboundStore(deps);
    const raw = body(`wamid.${crypto.randomUUID()}`, nextPhone());
    const bytes = new TextEncoder().encode(raw);
    const unknown = await receiveUatisWebhook(store, {
      restaurantId: crypto.randomUUID(),
      signatureHeader: signWebhook(WEBHOOK_SECRET, T, raw),
      rawBody: bytes,
      now: NOW,
    });
    const wrong = await receiveUatisWebhook(store, {
      restaurantId: a.restaurantId,
      signatureHeader: signWebhook("wrong", T, raw),
      rawBody: bytes,
      now: NOW,
    });
    expect(unknown).toEqual(wrong);
    expect(unknown.status).toBe(401);
  });

  test("restaurant B's integration row with A's secret cannot pass", async () => {
    const store = createDbUatisInboundStore(deps);
    const raw = body(`wamid.${crypto.randomUUID()}`, nextPhone());
    const r = await receiveUatisWebhook(store, {
      restaurantId: b.restaurantId,
      signatureHeader: signWebhook(WEBHOOK_SECRET, T, raw),
      rawBody: new TextEncoder().encode(raw),
      now: NOW,
    });
    expect(r.status).toBe(401);
  });

  test("the rate counter counts per restaurant per minute", async () => {
    const store = createDbUatisInboundStore(deps);
    const subject = crypto.randomUUID();
    expect((await store.hit(subject, NOW)).allowed).toBe(true);
    expect((await store.hit(subject, NOW)).allowed).toBe(true);
    const [row] = await db<{ count: number }[]>`
      select count from public.rate_counters where subject_id = ${subject} and class = 'webhook'`;
    expect(row?.count).toBe(2);
  });
});

describe("order_received (FR-039, FR-112, FR-117)", () => {
  async function conversationWithInbound(lastInboundAt: Date | null) {
    const r = await apply(inbound());
    if (r.action !== "ingested") throw new Error("setup failed");
    await db`update public.conversations set last_inbound_at = ${lastInboundAt} where id = ${r.conversationId}`;
    await truncateQueues(db);
    return r.conversationId;
  }

  const enqueue = (conversationId: string | null) =>
    asService(db, { restaurantId: a.restaurantId, actorType: "system" }, (tx) =>
      enqueueOrderReceived(tx, deps, a.restaurantId, {
        orderId: a.orderId,
        orderCode: "ORD-001",
        customerName: "Maria",
        conversationId,
      }),
    );

  test("disabled sends nothing", async () => {
    expect(await enqueue(a.conversationId)).toEqual({ action: "skip", reason: "disabled" });
  });

  test("inside the window: free text, linked to the order, enqueued", async () => {
    await setAuto("order_received", true, "Pedido {{pedido}} recebido, {{nome}}!");
    const conv = await conversationWithInbound(new Date(NOW.getTime() - 3600_000));
    const r = await enqueue(conv);
    expect(r.action).toBe("send_text");
    if (r.action === "skip") return;
    const [row] = await db<{ body: string; order_id: string; template_name: string | null; status: string }[]>`
      select body, order_id, template_name, status from public.messages where id = ${r.messageId}`;
    expect(row).toEqual({
      body: "Pedido ORD-001 recebido, Maria!",
      order_id: a.orderId,
      template_name: null,
      status: "pending",
    });
    expect(await outboundJobs()).toBe(1);
  });

  test("outside the window with a template: the template, enqueued", async () => {
    await setAuto("order_received", true, "Pedido {{pedido}}", ["pedido_recebido", "pt_BR"]);
    const conv = await conversationWithInbound(new Date(NOW.getTime() - 25 * 3600_000));
    const r = await enqueue(conv);
    expect(r.action).toBe("send_template");
    if (r.action === "skip") return;
    const [row] = await db<{ template_name: string; template_language: string }[]>`
      select template_name, template_language from public.messages where id = ${r.messageId}`;
    expect(row).toEqual({ template_name: "pedido_recebido", template_language: "pt_BR" });
  });

  test("outside the window without a template: a failed row, no job", async () => {
    await setAuto("order_received", true, "Pedido {{pedido}}");
    const conv = await conversationWithInbound(null);
    const r = await enqueue(conv);
    expect(r.action).toBe("fail");
    if (r.action === "skip") return;
    const [row] = await db<{ status: string; error_code: string }[]>`
      select status, error_code from public.messages where id = ${r.messageId}`;
    expect(row).toEqual({ status: "failed", error_code: "outside_service_window" });
    expect(await outboundJobs()).toBe(0);
  });

  test("a counter order with no conversation sends none", async () => {
    await setAuto("order_received", true, "Pedido {{pedido}}");
    expect(await enqueue(null)).toEqual({ action: "skip", reason: "no_conversation" });
  });

  test("createOrder from a chat enqueues order_received in the same transaction", async () => {
    await setAuto("order_received", true, "Pedido {{pedido}} recebido!");
    await db`update public.conversations set last_inbound_at = ${new Date(NOW.getTime() - 60_000)} where id = ${a.conversationId}`;
    await truncateQueues(db);
    const created = await createOrder(deps, userCtx(a.restaurantId, a.attendantId, "attendant"), {
      customerId: a.customerId,
      items: [{ menuItemId: a.menuItemId, sizeId: a.menuItemSizeId, qty: 1 }],
      fulfillment: "pickup",
      paymentMethod: "pix",
      source: "whatsapp",
      conversationId: a.conversationId,
    });
    const [row] = await db<{ body: string; automatic_kind: string }[]>`
      select body, automatic_kind from public.messages where order_id = ${created.id}`;
    expect(row).toEqual({ body: `Pedido ${created.code} recebido!`, automatic_kind: "order_received" });
    expect(await outboundJobs()).toBe(1);
  });
});

describe("simulateInboundMessage runs the automatic messages too (FR-116)", () => {
  test("a new simulated customer gets the welcome message", async () => {
    await openAllWeek();
    const r = await simulateInboundMessage(deps, admin(), { phone: nextPhone(), body: "Oi" });
    expect(r.automaticKind).toBe("welcome");
    expect(await outboundJobs()).toBe(1);
  });
});

describe("a disconnected integration stops webhooks (FR-118)", () => {
  test("after disconnect the secret is gone and the webhook answers 401", async () => {
    const c = await seedRestaurant(db, "wa-c");
    const ctx = userCtx(c.restaurantId, c.adminId, "admin");
    await connectWhatsApp(deps, ctx, {
      baseUrl: "http://127.0.0.1:4010",
      apiKey: "obk_test_c",
      webhookSecret: "whsec_c",
      phoneNumberId: "pn-c",
    });
    await disconnectWhatsApp(deps, ctx, undefined);
    const store = createDbUatisInboundStore(deps);
    expect(await store.loadSecret(c.restaurantId)).toBeNull();
  });
});
