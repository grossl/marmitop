// covers FR-200, FR-201, FR-202, FR-203, FR-204, FR-205, FR-114, FR-117, ADR-026, ADR-028
// Needs the local stack (`bun run dev:stack`) or TEST_DATABASE_URL.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { FixedClock, type OrderStatus } from "@mt/core";
import type { Db } from "@mt/db";
import { asService, createTestDb, type RestaurantFixture, seedRestaurant } from "@mt/db/test-harness";

import type { ApiKeyContext } from "../../context";
import type { ServiceDeps } from "../../deps";
import { createTestServiceDeps, userCtx } from "../../testing";
import { apiChangeOrderStatus } from "../public-api/orders";
import { cancelOrder, changeOrderStatus, changeOrderStatusInTx } from "./change-status";
import { createOrder } from "./create-order";

const NOW = new Date("2026-10-13T15:00:00Z");
const STATUS_KINDS: Record<string, string> = {
  order_confirmed: "Olá {{nome}}! Pedido {{pedido}} confirmado.",
  order_ready: "Pedido {{pedido}} pronto no {{restaurante}}.",
  order_out_for_delivery: "Pedido {{pedido}} saiu.",
  order_cancelled: "Pedido {{pedido}} cancelado.",
};

let db: Db;
let deps: ServiceDeps;
let a: RestaurantFixture;

const att = () => userCtx(a.restaurantId, a.attendantId, "attendant");
const keyCtx = (): ApiKeyContext => ({
  restaurantId: a.restaurantId,
  actorType: "api_key",
  apiKeyId: a.apiKeyId,
  role: "attendant",
});

async function setKind(kind: string, enabled: boolean) {
  await db`
    insert into public.automatic_messages (restaurant_id, kind, enabled, body)
    values (${a.restaurantId}, ${kind}, ${enabled}, ${STATUS_KINDS[kind] ?? "x"})
    on conflict (restaurant_id, kind) do update set enabled = excluded.enabled, body = excluded.body,
      template_name = null, template_language = null`;
}

async function newOrder(fulfillment: "pickup" | "delivery", withConversation = true) {
  const order = await createOrder(deps, att(), {
    customerId: a.customerId,
    items: [{ menuItemId: a.menuItemId, sizeId: a.menuItemSizeId, qty: 1 }],
    fulfillment,
    ...(fulfillment === "delivery" ? { logradouro: "Rua das Flores", numero: "342", bairro: "Vila Madalena" } : {}),
    paymentMethod: "pix",
    source: withConversation ? "whatsapp" : "counter",
    conversationId: withConversation ? a.conversationId : null,
  });
  return order;
}

const move = (orderId: string, toStatus: OrderStatus) => changeOrderStatus(deps, att(), { orderId, toStatus });

async function statusMessages(orderId: string) {
  const rows = await db<{ id: string; automatic_kind: string; body: string; status: string; sent_by: string | null }[]>`
    select id, automatic_kind, body, status, sent_by from public.messages
    where restaurant_id = ${a.restaurantId} and order_id = ${orderId} and automatic_kind like 'order\\_%'
      and automatic_kind <> 'order_received'
    order by created_at, id`;
  return [...rows];
}

async function jobsFor(messageIds: readonly string[]): Promise<number> {
  if (messageIds.length === 0) return 0;
  const [row] = await db<{ n: number }[]>`
    select count(*)::int as n from pgmq.q_mt_outbound_messages where message->>'messageId' in ${db(messageIds)}`;
  return row?.n ?? 0;
}

beforeAll(async () => {
  db = await createTestDb();
  deps = createTestServiceDeps(db, { clock: new FixedClock(NOW) });
  a = await seedRestaurant(db, "status-msg-a");
});

beforeEach(async () => {
  for (const kind of Object.keys(STATUS_KINDS)) await setKind(kind, true);
  // Inside the 24-hour window by default.
  await db`update public.conversations set last_inbound_at = ${new Date(NOW.getTime() - 3_600_000)}
    where id = ${a.conversationId}`;
});

afterAll(async () => {
  await db.end();
});

describe("status messages on a status move (FR-201, FR-205)", () => {
  test("a dashboard move sends one pending automatic row and one outbound job", async () => {
    const o = await newOrder("delivery");
    expect(await statusMessages(o.id)).toEqual([]); // the status at creation sends nothing
    await move(o.id, "confirmado");
    const rows = await statusMessages(o.id);
    expect(rows.map((r) => [r.automatic_kind, r.status, r.sent_by])).toEqual([["order_confirmed", "pending", null]]);
    expect(rows[0]?.body).toBe(`Olá Maria! Pedido ${o.code} confirmado.`);
    expect(await jobsFor(rows.map((r) => r.id))).toBe(1);
  });

  test("a forward skip sends only the target's message", async () => {
    const o = await newOrder("delivery");
    await move(o.id, "saiu");
    expect((await statusMessages(o.id)).map((r) => r.automatic_kind)).toEqual(["order_out_for_delivery"]);
  });

  test("a back step sends nothing", async () => {
    const o = await newOrder("pickup");
    await move(o.id, "pronto");
    await move(o.id, "confirmado");
    expect((await statusMessages(o.id)).map((r) => r.automatic_kind)).toEqual(["order_ready"]);
  });

  test("finalizado sends no message (ADR-028)", async () => {
    for (const fulfillment of ["delivery", "pickup"] as const) {
      const o = await newOrder(fulfillment);
      await move(o.id, "finalizado");
      expect(await statusMessages(o.id)).toEqual([]);
    }
  });

  test("a no-op move sends nothing", async () => {
    const o = await newOrder("delivery");
    await move(o.id, "aguardando");
    expect(await statusMessages(o.id)).toEqual([]);
  });

  test("each kind goes out once per order: pronto → confirmado → pronto on pickup (FR-203)", async () => {
    const o = await newOrder("pickup");
    await move(o.id, "pronto");
    await move(o.id, "confirmado");
    await move(o.id, "pronto");
    const rows = await statusMessages(o.id);
    expect(rows.map((r) => r.automatic_kind)).toEqual(["order_ready"]);
    expect(rows[0]?.body).toBe(`Pedido ${o.code} pronto no status-msg-a.`);
  });

  test("a delivery order at pronto sends nothing; saiu sends (FR-202)", async () => {
    const o = await newOrder("delivery");
    await move(o.id, "pronto");
    expect(await statusMessages(o.id)).toEqual([]);
    await move(o.id, "saiu");
    expect((await statusMessages(o.id)).map((r) => r.automatic_kind)).toEqual(["order_out_for_delivery"]);
  });

  test("a counter order with no conversation sends nothing", async () => {
    const o = await newOrder("pickup", false);
    await move(o.id, "confirmado");
    await move(o.id, "finalizado");
    expect(await statusMessages(o.id)).toEqual([]);
  });

  test("cancel sends order_cancelled", async () => {
    const o = await newOrder("delivery");
    await cancelOrder(deps, att(), { orderId: o.id, reason: "cliente desistiu" });
    const rows = await statusMessages(o.id);
    expect(rows.map((r) => r.automatic_kind)).toEqual(["order_cancelled"]);
    expect(await jobsFor(rows.map((r) => r.id))).toBe(1);
  });

  test("a disabled kind sends nothing", async () => {
    await setKind("order_confirmed", false);
    const o = await newOrder("delivery");
    await move(o.id, "confirmado");
    expect(await statusMessages(o.id)).toEqual([]);
  });

  test("outside the window with no template: a failed row and no job (FR-204)", async () => {
    await db`update public.conversations set last_inbound_at = null where id = ${a.conversationId}`;
    const o = await newOrder("delivery");
    await move(o.id, "confirmado");
    const rows = await db<{ id: string; status: string; error_code: string | null }[]>`
      select id, status, error_code from public.messages
      where order_id = ${o.id} and automatic_kind = 'order_confirmed'`;
    expect(rows.map((r) => [r.status, r.error_code])).toEqual([["failed", "outside_service_window"]]);
    expect(await jobsFor(rows.map((r) => r.id))).toBe(0);
  });

  test("a failed status message counts as sent: back step and forward again add no second row (FR-203)", async () => {
    await db`update public.conversations set last_inbound_at = null where id = ${a.conversationId}`;
    const o = await newOrder("delivery");
    await move(o.id, "confirmado");
    await db`update public.conversations set last_inbound_at = ${new Date(NOW.getTime() - 60_000)}
      where id = ${a.conversationId}`;
    await move(o.id, "aguardando");
    await move(o.id, "confirmado");
    const rows = await statusMessages(o.id);
    expect(rows.map((r) => [r.automatic_kind, r.status])).toEqual([["order_confirmed", "failed"]]);
  });

  test("outside the window with a template: a template row and one job (FR-204)", async () => {
    await db`
      update public.automatic_messages set template_name = 'pedido_saiu', template_language = 'pt_BR'
      where restaurant_id = ${a.restaurantId} and kind = 'order_out_for_delivery'`;
    await db`update public.conversations set last_inbound_at = ${new Date(NOW.getTime() - 30 * 3_600_000)}
      where id = ${a.conversationId}`;
    const o = await newOrder("delivery");
    await move(o.id, "saiu");
    const rows = await db<
      { id: string; status: string; template_name: string | null; template_language: string | null }[]
    >`
      select id, status, template_name, template_language from public.messages
      where order_id = ${o.id} and automatic_kind = 'order_out_for_delivery'`;
    expect(rows.map((r) => [r.status, r.template_name, r.template_language])).toEqual([
      ["pending", "pedido_saiu", "pt_BR"],
    ]);
    expect(await jobsFor(rows.map((r) => r.id))).toBe(1);
  });

  test("a status change through the public API sends (api_key actor)", async () => {
    const o = await newOrder("delivery");
    await apiChangeOrderStatus(deps, keyCtx(), { id: o.code, status: "saiu" });
    expect((await statusMessages(o.id)).map((r) => r.automatic_kind)).toEqual(["order_out_for_delivery"]);
  });

  test("a system actor sends too", async () => {
    const o = await newOrder("pickup");
    await asService(db, { restaurantId: a.restaurantId, actorType: "system" }, (tx) =>
      changeOrderStatusInTx(tx, { restaurantId: a.restaurantId, actorType: "system" }, o.id, "pronto", undefined, NOW),
    );
    expect((await statusMessages(o.id)).map((r) => r.automatic_kind)).toEqual(["order_ready"]);
  });

  test("a rolled-back status change leaves no row and no job", async () => {
    const o = await newOrder("delivery");
    const queued = async () => {
      const [row] = await db<{ n: number }[]>`
        select count(*)::int as n from pgmq.q_mt_outbound_messages where message->>'restaurantId' = ${a.restaurantId}`;
      return row?.n ?? 0;
    };
    const before = await queued();
    const rollback = new Error("rollback");
    const e = await asService(db, { restaurantId: a.restaurantId, actorType: "system" }, async (tx) => {
      await changeOrderStatusInTx(
        tx,
        { restaurantId: a.restaurantId, actorType: "system" },
        o.id,
        "confirmado",
        undefined,
        NOW,
      );
      throw rollback;
    }).catch((x) => x);
    expect(e).toBe(rollback);
    expect(await statusMessages(o.id)).toEqual([]);
    expect(await queued()).toBe(before);
  });
});
