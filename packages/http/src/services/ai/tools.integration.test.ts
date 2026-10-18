// covers FR-184, FR-185, FR-186, FR-187, FR-190, FR-195
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { FixedClock } from "@mt/core";
import { type Db, withRestaurantContext } from "@mt/db";
import { createTestDb, type RestaurantFixture, seedRestaurant } from "@mt/db/test-harness";

import { toDbContext } from "../../context";
import type { ServiceDeps } from "../../deps";
import { createTestServiceDeps } from "../../testing";
import { systemCtx } from "../whatsapp/connection";
import { type AiToolScope, runAiTool } from "./tools";

let db: Db;
let deps: ServiceDeps;
let a: RestaurantFixture;
let b: RestaurantFixture;
let scope: AiToolScope;
// Tuesday 12:00 in São Paulo. The setup opens every day 00:00-23:59.
const NOW = new Date("2026-10-13T15:00:00Z");

const run = (name: string, input: unknown, s: AiToolScope = scope) =>
  withRestaurantContext(
    db,
    toDbContext(systemCtx(s.restaurantId)),
    (tx) => runAiTool(tx, deps, s, name, input),
    deps.contextOptions,
  );
const json = (c: string) => JSON.parse(c) as Record<string, unknown>;

async function inbound(body: string, at: Date): Promise<void> {
  await db`insert into public.messages (restaurant_id, conversation_id, direction, body, status, created_at)
           values (${a.restaurantId}, ${a.conversationId}, 'in', ${body}, 'delivered', ${at})`;
}

beforeAll(async () => {
  db = await createTestDb();
  deps = createTestServiceDeps(db, { clock: new FixedClock(NOW.toISOString()) });
  a = await seedRestaurant(db, "tools-a");
  b = await seedRestaurant(db, "tools-b");
  // The seed opens Monday only. Open every weekday all day for both restaurants.
  for (const rid of [a.restaurantId, b.restaurantId]) {
    for (let weekday = 0; weekday <= 6; weekday++) {
      await db`insert into public.business_hours (restaurant_id, weekday, enabled, opens_at, closes_at)
               values (${rid}, ${weekday}, true, '00:00', '23:59')
               on conflict (restaurant_id, weekday) do update set enabled = true, opens_at = '00:00', closes_at = '23:59'`;
    }
  }
  await db`update public.restaurant_settings set allow_pickup = true, delivery_fee_cents = 500
           where restaurant_id = ${a.restaurantId}`;
  // The seed inbound message is stamped with the database clock (after NOW). Move it before NOW,
  // or it would count as a reply to every summary sent at NOW.
  await db`update public.messages set created_at = ${new Date(NOW.getTime() - 3_600_000)}
           where conversation_id = ${a.conversationId}`;
});
beforeEach(async () => {
  await db`delete from public.ai_carts where restaurant_id = ${a.restaurantId}`;
  // Each test starts with no customer reply after NOW and with the seed customer's saved fields.
  await db`delete from public.messages
           where conversation_id = ${a.conversationId} and direction = 'in' and created_at >= ${NOW}`;
  await db`update public.customers set name = 'Maria', logradouro = 'Rua das Flores', numero = '342',
             complemento = null, bairro = 'Vila Madalena'
           where id = ${a.customerId}`;
  const [r] = await db<{ id: string }[]>`
    insert into public.ai_runs (restaurant_id, conversation_id, trigger_message_id, status)
    values (${a.restaurantId}, ${a.conversationId}, ${a.messageId}, 'running') returning id`;
  scope = { restaurantId: a.restaurantId, conversationId: a.conversationId, customerId: a.customerId, runId: r!.id };
});
afterAll(async () => db.end());

const cartInput = (
  fulfillment: "pickup" | "delivery" | null,
  address: Record<string, string | null> | null = null,
) => ({
  items: [{ menu_item_id: a.menuItemId, size_id: a.menuItemSizeId, quantity: 2, notes: null }],
  fulfillment,
  address: address && { logradouro: null, numero: null, bairro: null, complemento: null, ...address },
  customer_name: null,
});

describe("search_menu", () => {
  test("lists today's available items with sizes and BRL prices", async () => {
    const r = await run("search_menu", { query: null });
    expect(r.ok).toBe(true);
    const items = json(r.content).items as { menu_item_id: string; sizes: { size_id: string; price: string }[] }[];
    expect(items.some((i) => i.menu_item_id === a.menuItemId)).toBe(true);
  });
  test("an unavailable item is not listed", async () => {
    await db`update public.menu_items set available = false where id = ${a.menuItemId}`;
    const items = json((await run("search_menu", { query: null })).content).items as { menu_item_id: string }[];
    expect(items.some((i) => i.menu_item_id === a.menuItemId)).toBe(false);
    await db`update public.menu_items set available = true where id = ${a.menuItemId}`;
  });
});

describe("update_cart", () => {
  test("returns totals and missing fields; stores no price", async () => {
    const r = json((await run("update_cart", cartInput("delivery"))).content);
    expect(r.missing).toEqual(["logradouro", "bairro"]);
    expect(typeof r.total).toBe("string");
    const [c] = await db<{ items: unknown[]; fulfillment: string }[]>`
      select items, fulfillment from public.ai_carts where conversation_id = ${a.conversationId} and status = 'open'`;
    expect(JSON.stringify(c?.items)).not.toContain("price");
  });
  test("pickup is refused when the setting is off", async () => {
    await db`update public.restaurant_settings set allow_pickup = false where restaurant_id = ${a.restaurantId}`;
    const r = await run("update_cart", cartInput("pickup"));
    expect(r).toMatchObject({ ok: false, errorCode: "pickup_disabled" });
    await db`update public.restaurant_settings set allow_pickup = true where restaurant_id = ${a.restaurantId}`;
  });
  test("an item of another restaurant is item_unavailable", async () => {
    const r = await run("update_cart", {
      ...cartInput("pickup"),
      items: [{ menu_item_id: b.menuItemId, size_id: null, quantity: 1, notes: null }],
    });
    expect(r).toMatchObject({ ok: false, errorCode: "item_unavailable" });
  });
  test("invalid input is rejected before any query", async () => {
    const r = await run("update_cart", { items: "two" });
    expect(r).toMatchObject({ ok: false, errorCode: "invalid_input" });
  });
  test("invalid input names the failing field so the model can correct it", async () => {
    const input = cartInput("pickup");
    const r = await run("update_cart", { ...input, items: [{ ...input.items[0], quantity: 51 }] });
    expect(r).toMatchObject({ ok: false, errorCode: "invalid_input" });
    expect(r.content).toContain("items.0.quantity");
    expect(r.content).not.toContain("51");
  });
});

describe("summary and place_order", () => {
  test("summary needs a complete cart", async () => {
    await run("update_cart", cartInput("delivery"));
    expect(await run("send_order_summary", {})).toMatchObject({ ok: false, errorCode: "cart_incomplete" });
  });

  test("full path: summary, customer reply, order", async () => {
    await run("update_cart", cartInput("delivery", { logradouro: "Rua das Flores", numero: "120", bairro: "Centro" }));
    expect((await run("send_order_summary", {})).ok).toBe(true);
    const [s] = await db<{ body: string; ai_run_id: string }[]>`
      select body, ai_run_id from public.messages where conversation_id = ${a.conversationId} and direction = 'out'
      order by created_at desc limit 1`;
    expect(s?.body).toContain("Posso confirmar?");
    expect(s?.ai_run_id).toBe(scope.runId);

    expect(await run("place_order", {})).toMatchObject({ ok: false, errorCode: "not_confirmed" });
    await inbound("sim", new Date(NOW.getTime() + 1000));

    const placed = await run("place_order", {});
    expect(placed.ok).toBe(true);
    const code = json(placed.content).code as string;
    const [o] = await db<{ source: string; payment_method: string | null; ai_run_id: string; logradouro: string }[]>`
      select source, payment_method, ai_run_id, logradouro from public.orders where restaurant_id = ${a.restaurantId} and code = ${code}`;
    expect(o).toEqual({
      source: "whatsapp",
      payment_method: null,
      ai_run_id: scope.runId,
      logradouro: "Rua das Flores",
    });

    const again = await run("place_order", {});
    expect(json(again.content).code).toBe(code);
  });

  test("a cart changed after the summary is not confirmed", async () => {
    await run("update_cart", cartInput("pickup"));
    await run("send_order_summary", {});
    await inbound("sim", new Date(NOW.getTime() + 1000));
    await run("update_cart", {
      ...cartInput("pickup"),
      items: [{ menu_item_id: a.menuItemId, size_id: a.menuItemSizeId, quantity: 3, notes: null }],
    });
    expect(await run("place_order", {})).toMatchObject({ ok: false, errorCode: "not_confirmed" });
  });
});

describe("cart lifetime (database clock)", () => {
  test("a placed cart older than 30 minutes does not answer a new place_order", async () => {
    await db`insert into public.ai_carts (restaurant_id, conversation_id, status, fulfillment, order_id, updated_at)
             values (${a.restaurantId}, ${a.conversationId}, 'placed', 'pickup', ${a.orderId}, now() - interval '31 minutes')`;
    const r = await run("place_order", {});
    expect(r).toMatchObject({ ok: false, errorCode: "not_confirmed" });
  });

  test("a placed cart within 30 minutes answers with its order", async () => {
    await db`insert into public.ai_carts (restaurant_id, conversation_id, status, fulfillment, order_id, updated_at)
             values (${a.restaurantId}, ${a.conversationId}, 'placed', 'pickup', ${a.orderId}, now() - interval '29 minutes')`;
    const r = await run("place_order", {});
    expect(r.ok).toBe(true);
    expect(json(r.content).code).toBe("ORD-001");
  });

  test("an open cart older than 6 hours is abandoned and update_cart starts a fresh cart", async () => {
    const [old] = await db<{ id: string }[]>`
      insert into public.ai_carts (restaurant_id, conversation_id, status, fulfillment, logradouro, bairro, version, updated_at)
      values (${a.restaurantId}, ${a.conversationId}, 'open', 'delivery', 'Rua Velha', 'Centro', 4, now() - interval '6 hours 1 minute')
      returning id`;
    const r = await run("update_cart", cartInput("pickup"));
    expect(r.ok).toBe(true);
    expect(json(r.content).address).toEqual({ logradouro: null, numero: null, bairro: null, complemento: null });
    const rows = await db<{ id: string; status: string; logradouro: string | null }[]>`
      select id, status, logradouro from public.ai_carts where conversation_id = ${a.conversationId} order by created_at`;
    expect(rows.find((c) => c.id === old!.id)?.status).toBe("abandoned");
    const open = rows.filter((c) => c.status === "open");
    expect(open).toHaveLength(1);
    expect(open[0]?.id).not.toBe(old!.id);
    expect(open[0]?.logradouro).toBeNull();
  });
});

describe("customer back-fill (FR-187)", () => {
  type Customer = {
    name: string;
    phone: string;
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
  };
  const customer = async () =>
    (
      await db<Customer[]>`
      select name, phone, logradouro, numero, complemento, bairro from public.customers where id = ${a.customerId}`
    )[0]!;

  async function placeWith(input: ReturnType<typeof cartInput>, customerName: string | null): Promise<string> {
    await run("update_cart", { ...input, customer_name: customerName });
    expect((await run("send_order_summary", {})).ok).toBe(true);
    await inbound("sim", new Date(NOW.getTime() + 1000));
    const placed = await run("place_order", {});
    expect(placed.ok).toBe(true);
    return json(placed.content).code as string;
  }

  test("a name equal to the phone is filled before the order, so order_received greets by name", async () => {
    await db`update public.customers set name = phone where id = ${a.customerId}`;
    await db`insert into public.automatic_messages (restaurant_id, kind, enabled, body)
             values (${a.restaurantId}, 'order_received', true, 'Oi {{nome}}, recebemos o pedido {{pedido}}.')
             on conflict (restaurant_id, kind) do update set enabled = true, body = excluded.body`;
    const { phone } = await customer();
    const code = await placeWith(cartInput("pickup"), "João");
    expect((await customer()).name).toBe("João");
    const [m] = await db<{ body: string }[]>`
      select m.body from public.messages m join public.orders o on o.id = m.order_id
      where o.restaurant_id = ${a.restaurantId} and o.code = ${code} and m.automatic_kind = 'order_received'`;
    expect(m?.body).toContain("João");
    expect(m?.body).not.toContain(phone);
    await db`update public.automatic_messages set enabled = false where restaurant_id = ${a.restaurantId} and kind = 'order_received'`;
  });

  test("a saved name is kept", async () => {
    await placeWith(cartInput("pickup"), "João");
    expect((await customer()).name).toBe("Maria");
  });

  test("a saved address is kept", async () => {
    await placeWith(
      cartInput("delivery", { logradouro: "Rua Nova", numero: "9", bairro: "Centro", complemento: "ap 2" }),
      null,
    );
    expect(await customer()).toMatchObject({
      logradouro: "Rua das Flores",
      numero: "342",
      complemento: "ap 2",
      bairro: "Vila Madalena",
    });
  });

  test("a pickup order leaves saved numero and complemento alone", async () => {
    await db`update public.customers set logradouro = null, numero = '10', complemento = 'casa 3' where id = ${a.customerId}`;
    await placeWith(cartInput("pickup"), null);
    expect(await customer()).toMatchObject({ logradouro: null, numero: "10", complemento: "casa 3" });
  });

  test("a delivery cart with a street but no numero never erases a saved numero", async () => {
    await db`update public.customers set logradouro = null, numero = '10', complemento = null where id = ${a.customerId}`;
    await placeWith(cartInput("delivery", { logradouro: "Rua Nova", numero: null, bairro: "Centro" }), null);
    expect(await customer()).toMatchObject({
      logradouro: "Rua Nova",
      numero: "10",
      complemento: null,
      bairro: "Vila Madalena",
    });
  });
});

describe("handoff_to_human", () => {
  test("pauses the conversation with reason and note", async () => {
    await run("handoff_to_human", { reason: "complaint", note: "Cliente reclamou do atraso." });
    const [c] = await db<{ ai_mode: string; ai_pause_reason: string; ai_pause_note: string }[]>`
      select ai_mode, ai_pause_reason, ai_pause_note from public.conversations where id = ${a.conversationId}`;
    expect(c).toEqual({
      ai_mode: "paused",
      ai_pause_reason: "complaint",
      ai_pause_note: "Cliente reclamou do atraso.",
    });
    await db`update public.conversations set ai_mode = 'auto', ai_pause_reason = null, ai_pause_note = null where id = ${a.conversationId}`;
  });
});

describe("tenant isolation", () => {
  test("a scope of restaurant B never reads restaurant A's menu", async () => {
    const [r] = await db<{ id: string }[]>`
      insert into public.ai_runs (restaurant_id, conversation_id, trigger_message_id, status)
      values (${b.restaurantId}, ${b.conversationId}, ${b.messageId}, 'running') returning id`;
    const sb = {
      restaurantId: b.restaurantId,
      conversationId: b.conversationId,
      customerId: b.customerId,
      runId: r!.id,
    };
    const items = json((await run("search_menu", { query: null }, sb)).content).items as { menu_item_id: string }[];
    expect(items.some((i) => i.menu_item_id === a.menuItemId)).toBe(false);
  });
});

describe("unknown tool", () => {
  test("returns unknown_tool", async () => {
    expect(await run("drop_tables", {})).toMatchObject({ ok: false, errorCode: "unknown_tool" });
  });
});
