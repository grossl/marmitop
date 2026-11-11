// covers FR-230, FR-231, FR-232, FR-233, FR-234, FR-235, FR-236, FR-238, FR-239, FR-240, FR-241, ADR-006, ADR-033, ADR-035, ADR-036, NFR-001
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AppError, FixedClock } from "@mt/core";
import type { Db } from "@mt/db";
import { asService, createTestDb, type RestaurantFixture, seedRestaurant } from "@mt/db/test-harness";

import type { ServiceDeps } from "../../deps";
import { createTestServiceDeps, userCtx } from "../../testing";
import { saveMenuItem } from "../catalog/menu";
import { getPublicMenu } from "../catalog/public-menu";
import { simulateInboundMessage } from "../messaging";
import { applyGatewayMessage } from "../whatsapp/gateway-events";
import { clientRateSubject, PUBLIC_ORDER_LIMITS, type PublicOrderInput, preparePublicOrder } from "./menu-order-drafts";

let db: Db;
let deps: ServiceDeps;
let a: RestaurantFixture;
let publicId: string;
let mealId: string;
let sizedId: string;
let sizeGId: string;

const code = (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`);
const detailCode = (e: unknown) => (e instanceof AppError ? e.details?.[0]?.code : undefined);

async function caught(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected a rejection");
}

let phoneCounter = 0;
/** A fresh WhatsApp sender per test, E.164 as the gateway sends it. */
function nextPhone(): string {
  phoneCounter += 1;
  return `+55119888${String(10000 + phoneCounter)}`;
}

function order(overrides: Partial<PublicOrderInput> = {}): PublicOrderInput {
  return {
    name: "Ana Souza",
    items: [{ menuItemId: mealId, qty: 2 }],
    fulfillment: "delivery",
    logradouro: "Rua das Flores",
    numero: "10",
    complemento: null,
    bairro: "Centro",
    paymentMethod: "pix",
    changeForCents: null,
    notes: null,
    ...overrides,
  };
}

beforeAll(async () => {
  db = await createTestDb();
  deps = createTestServiceDeps(db); // clock: Tuesday 2026-10-13 12:00 in São Paulo
  a = await seedRestaurant(db, "public-order-a");
  const [row] = await db<
    { public_id: string }[]
  >`select public_id from public.restaurants where id = ${a.restaurantId}`;
  publicId = row?.public_id ?? "";
  // Open every day 08:00–22:00; auto-accept on, to prove public orders still wait (FR-232).
  await db`delete from public.business_hours where restaurant_id = ${a.restaurantId}`;
  for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
    await db`insert into public.business_hours (restaurant_id, weekday, opens_at, closes_at)
             values (${a.restaurantId}, ${weekday}, '08:00', '22:00')`;
  }
  await db`update public.restaurant_settings set auto_accept = true, delivery_fee_cents = 500
           where restaurant_id = ${a.restaurantId}`;

  const admin = userCtx(a.restaurantId, a.adminId, "admin");
  const base = {
    kind: "meal" as const,
    description: null,
    category: "proteinas",
    calories: null,
    available: true,
    popular: false,
    availableWeekdays: [0, 1, 2, 3, 4, 5, 6],
  };
  mealId = (await saveMenuItem(deps, admin, { ...base, name: "Frango Público", priceCents: 1890 })).id;
  const sized = await saveMenuItem(deps, admin, {
    ...base,
    name: "Executiva Pública",
    priceCents: 0,
    sizes: [
      { name: "P", priceCents: 1500 },
      { name: "G", priceCents: 2200 },
    ],
  });
  sizedId = sized.id;
  sizeGId = sized.sizes.find((s) => s.name === "G")?.id ?? "";
});

afterAll(async () => {
  await db.end();
});

async function orderCount(): Promise<number> {
  const [row] = await db<
    { n: number }[]
  >`select count(*)::int as n from public.orders where restaurant_id = ${a.restaurantId}`;
  return row?.n ?? 0;
}

describe("getPublicMenu ordering fields", () => {
  test("returns the fee, pickup, open state, and size ids", async () => {
    const menu = await getPublicMenu(deps, publicId);
    expect(menu).toMatchObject({ allowPickup: true, deliveryFeeCents: 500, openNow: true });
    const sizedItem = menu?.items.find((i) => i.id === sizedId);
    expect(sizedItem?.sizes.map((s) => s.id)).toContain(sizeGId);
  });
});

describe("preparePublicOrder", () => {
  test("saves a draft and returns the WhatsApp text with the reference and the server total", async () => {
    const before = await orderCount();
    const prepared = await preparePublicOrder(
      deps,
      publicId,
      order({
        items: [
          { menuItemId: mealId, qty: 2 },
          { menuItemId: sizedId, sizeId: sizeGId, qty: 1 },
        ],
      }),
    );
    expect(prepared.reference).toMatch(/^[A-Z2-9]{8}$/);
    expect(prepared.totalCents).toBe(2 * 1890 + 2200 + 500);
    expect(prepared.whatsappText).toContain("2x Frango Público — R$ 37,80");
    expect(prepared.whatsappText).toContain("1x Executiva Pública (G) — R$ 22,00");
    expect(prepared.whatsappText).toContain("*Total: R$ 64,80*");
    expect(prepared.whatsappText).toContain("Rua das Flores, 10");
    expect(prepared.whatsappText).toContain(`Ref.: #${prepared.reference}`);
    // FR-232: the page creates no order.
    expect(await orderCount()).toBe(before);
    const [draft] = await db<{ order_id: string | null; payload: { name: string } }[]>`
      select order_id, payload from public.menu_order_drafts
      where restaurant_id = ${a.restaurantId} and reference = ${prepared.reference}`;
    expect(draft?.order_id).toBeNull();
    expect(draft?.payload.name).toBe("Ana Souza");
  });

  test("a client price or a phone is not accepted", async () => {
    const tampered = order({ items: [{ menuItemId: mealId, qty: 1, priceCents: 1 } as never] });
    expect(code(await caught(() => preparePublicOrder(deps, publicId, tampered)))).toBe("validation_failed");
    const withPhone = { ...order(), phone: "+5511999990000" } as never;
    expect(code(await caught(() => preparePublicOrder(deps, publicId, withPhone)))).toBe("validation_failed");
  });

  test("delivery without rua or bairro is refused with field details", async () => {
    const e = await caught(() => preparePublicOrder(deps, publicId, order({ logradouro: null, bairro: "" })));
    expect(code(e)).toBe("validation_failed");
    const paths = e instanceof AppError ? (e.details ?? []).map((d) => d.path) : [];
    expect(paths).toEqual(expect.arrayContaining(["logradouro", "bairro"]));
  });

  test("pickup needs no address and has no fee", async () => {
    const prepared = await preparePublicOrder(
      deps,
      publicId,
      order({ fulfillment: "pickup", logradouro: null, numero: null, bairro: null, paymentMethod: "dinheiro" }),
    );
    expect(prepared.totalCents).toBe(2 * 1890);
    expect(prepared.whatsappText).toContain("*Retirada no local*");
  });

  test("change below the total is refused", async () => {
    const e = await caught(() =>
      preparePublicOrder(deps, publicId, order({ paymentMethod: "dinheiro", changeForCents: 100 })),
    );
    expect(code(e)).toBe("validation_failed");
    expect(detailCode(e)).toBe("too_small");
  });

  test("an unknown or malformed public id is not_found", async () => {
    expect(code(await caught(() => preparePublicOrder(deps, "ffffffffffff", order())))).toBe("not_found");
    expect(code(await caught(() => preparePublicOrder(deps, a.restaurantId, order())))).toBe("not_found");
  });

  test("a closed restaurant refuses the checkout", async () => {
    const lateDeps = createTestServiceDeps(db, { clock: new FixedClock("2026-10-14T03:00:00Z") }); // 00:00 local
    const e = await caught(() => preparePublicOrder(lateDeps, publicId, order()));
    expect(code(e)).toBe("validation_failed");
    expect(detailCode(e)).toBe("restaurant_closed");
    expect((await getPublicMenu(lateDeps, publicId))?.openNow).toBe(false);
  });
});

describe("the WhatsApp message makes the order (FR-239)", () => {
  const admin = () => userCtx(a.restaurantId, a.adminId, "admin");

  async function menuOrdersOf(phone: string) {
    return db<{ id: string; status: string; source: string; conversation_id: string | null; total_cents: number }[]>`
      select o.id, o.status, o.source, o.conversation_id, o.total_cents from public.orders o
      join public.customers c on c.id = o.customer_id and c.restaurant_id = o.restaurant_id
      where o.restaurant_id = ${a.restaurantId} and c.phone = ${phone} and o.source = 'menu'`;
  }

  test("the message creates one aguardando order for the sender, with the conversation", async () => {
    await db`insert into public.ai_settings (restaurant_id, enabled) values (${a.restaurantId}, true)
             on conflict (restaurant_id) do update set enabled = true`;
    await db`insert into public.automatic_messages (restaurant_id, kind, enabled, body)
             values (${a.restaurantId}, 'order_received', true, 'Recebemos o pedido {{pedido}}.')
             on conflict (restaurant_id, kind) do update set enabled = true`;
    const phone = nextPhone();
    const prepared = await preparePublicOrder(deps, publicId, order({ name: "Bruno Lima" }));
    const sim = await simulateInboundMessage(deps, admin(), { phone, body: prepared.whatsappText });

    const orders = await menuOrdersOf(phone);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      status: "aguardando", // also with auto-accept on (FR-232)
      conversation_id: sim.conversationId,
      total_cents: prepared.totalCents,
    });
    const [draft] = await db<{ order_id: string | null }[]>`
      select order_id from public.menu_order_drafts where reference = ${prepared.reference}`;
    expect(draft?.order_id).toBe(orders[0]?.id ?? "");
    // FR-233: the new WhatsApp customer gets the draft's name and address.
    const [customer] = await db<{ name: string; logradouro: string }[]>`
      select name, logradouro from public.customers where restaurant_id = ${a.restaurantId} and phone = ${phone}`;
    expect(customer).toEqual({ name: "Bruno Lima", logradouro: "Rua das Flores" });
    // order_received, and no welcome.
    const kinds = await db<{ automatic_kind: string }[]>`
      select automatic_kind from public.messages
      where conversation_id = ${sim.conversationId} and automatic_kind is not null`;
    expect(kinds.map((k) => k.automatic_kind)).toEqual(["order_received"]);
    // The AI would create the order again from the text: it pauses, and no turn is queued.
    const [conv] = await db<{ ai_mode: string; ai_pause_reason: string | null }[]>`
      select ai_mode, ai_pause_reason from public.conversations where id = ${sim.conversationId}`;
    expect(conv).toEqual({ ai_mode: "paused", ai_pause_reason: "attendant" });
    const [jobs] = await db<{ n: number }[]>`
      select count(*)::int as n from pgmq.q_mt_ai_turns where message->>'conversationId' = ${sim.conversationId}`;
    expect(jobs?.n).toBe(0);
  });

  test("a known customer keeps the saved name and address; the order keeps the typed address", async () => {
    const phone = nextPhone();
    await db`insert into public.customers (restaurant_id, name, phone, logradouro, bairro)
             values (${a.restaurantId}, 'Carla', ${phone}, 'Rua A', 'Bairro A')`;
    const prepared = await preparePublicOrder(
      deps,
      publicId,
      order({ name: "Outra Pessoa", logradouro: "Rua B", bairro: "Bairro B" }),
    );
    await simulateInboundMessage(deps, admin(), { phone, body: prepared.whatsappText });
    const [customer] = await db<{ name: string; logradouro: string }[]>`
      select name, logradouro from public.customers where restaurant_id = ${a.restaurantId} and phone = ${phone}`;
    expect(customer).toEqual({ name: "Carla", logradouro: "Rua A" });
    const [o] = await db<{ logradouro: string }[]>`
      select o.logradouro from public.orders o join public.menu_order_drafts d on d.order_id = o.id
      where d.reference = ${prepared.reference}`;
    expect(o?.logradouro).toBe("Rua B");
  });

  test("a second message with the same reference creates nothing", async () => {
    const prepared = await preparePublicOrder(deps, publicId, order());
    const phone = nextPhone();
    await simulateInboundMessage(deps, admin(), { phone, body: prepared.whatsappText });
    const other = nextPhone();
    await simulateInboundMessage(deps, admin(), { phone: other, body: prepared.whatsappText });
    await simulateInboundMessage(deps, admin(), { phone, body: prepared.whatsappText });
    expect(await menuOrdersOf(phone)).toHaveLength(1);
    expect(await menuOrdersOf(other)).toHaveLength(0);
  });

  test("an expired draft or an unknown reference creates nothing", async () => {
    const prepared = await preparePublicOrder(deps, publicId, order());
    await db`update public.menu_order_drafts set expires_at = now() - interval '1 minute'
             where restaurant_id = ${a.restaurantId} and reference = ${prepared.reference}`;
    const phone = nextPhone();
    await simulateInboundMessage(deps, admin(), { phone, body: prepared.whatsappText });
    await simulateInboundMessage(deps, admin(), { phone, body: "Pedido Ref.: #ZZZZZZZZ" });
    expect(await menuOrdersOf(phone)).toHaveLength(0);
  });

  test("a draft that breaks an order rule leaves the message on the normal path", async () => {
    await db`update public.ai_settings set enabled = true where restaurant_id = ${a.restaurantId}`;
    const admin2 = userCtx(a.restaurantId, a.adminId, "admin");
    const gone = await saveMenuItem(deps, admin2, {
      kind: "meal",
      description: null,
      category: "proteinas",
      calories: null,
      available: true,
      popular: false,
      availableWeekdays: [0, 1, 2, 3, 4, 5, 6],
      name: "Some Logo",
      priceCents: 1000,
    });
    const prepared = await preparePublicOrder(deps, publicId, order({ items: [{ menuItemId: gone.id, qty: 1 }] }));
    await db`update public.menu_items set archived_at = now() where id = ${gone.id}`;
    const phone = nextPhone();
    const sim = await simulateInboundMessage(deps, admin(), { phone, body: prepared.whatsappText });
    expect(await menuOrdersOf(phone)).toHaveLength(0);
    const [jobs] = await db<{ n: number }[]>`
      select count(*)::int as n from pgmq.q_mt_ai_turns where message->>'conversationId' = ${sim.conversationId}`;
    expect(jobs?.n).toBe(1);
  });
});

describe("auto-confirm menu orders (FR-240)", () => {
  const admin = () => userCtx(a.restaurantId, a.adminId, "admin");

  async function convertedOrder(reference: string) {
    const [row] = await db<{ id: string; status: string }[]>`
      select o.id, o.status from public.orders o join public.menu_order_drafts d on d.order_id = o.id
      where d.restaurant_id = ${a.restaurantId} and d.reference = ${reference}`;
    return row;
  }

  test("with the switch on, the order moves to confirmado and only order_received goes out", async () => {
    await db`update public.restaurant_settings set auto_confirm_menu_orders = true where restaurant_id = ${a.restaurantId}`;
    await db`insert into public.automatic_messages (restaurant_id, kind, enabled, body)
             values (${a.restaurantId}, 'order_confirmed', true, 'Pedido {{pedido}} confirmado.')
             on conflict (restaurant_id, kind) do update set enabled = true`;
    try {
      const prepared = await preparePublicOrder(deps, publicId, order());
      // The real inbound path (webhook and poll) runs as the system actor.
      await asService(db, { restaurantId: a.restaurantId, actorType: "system" }, (tx) =>
        applyGatewayMessage(tx, deps, a.restaurantId, {
          externalId: `wamid.${prepared.reference}`,
          conversationExternalId: null,
          direction: "in",
          body: prepared.whatsappText,
          contentType: "text",
          status: "delivered",
          contactAddress: nextPhone(),
          createdAt: new Date(),
        }),
      );
      const placed = await convertedOrder(prepared.reference);
      expect(placed?.status).toBe("confirmado");
      const history = await db<{ from_status: string | null; to_status: string; actor_type: string }[]>`
        select from_status, to_status, actor_type from public.order_status_history
        where order_id = ${placed?.id ?? ""} order by changed_at, from_status nulls first`;
      expect(history.map((h) => [h.from_status, h.to_status])).toEqual([
        [null, "aguardando"],
        ["aguardando", "confirmado"],
      ]);
      expect(history[1]?.actor_type).toBe("system");
      const sent = await db<{ automatic_kind: string; body: string }[]>`
        select automatic_kind, body from public.messages where order_id = ${placed?.id ?? ""} and automatic_kind is not null`;
      // FR-241: the confirmed text by fulfillment (delivery here), and no order_confirmed.
      expect(sent.find((m) => m.automatic_kind === "order_received")?.body).toBe(
        "Recebemos seu pedido! Avisaremos quando seu pedido for enviado.",
      );
      expect(sent.map((m) => m.automatic_kind)).toEqual(["order_received"]);
    } finally {
      await db`update public.restaurant_settings set auto_confirm_menu_orders = false where restaurant_id = ${a.restaurantId}`;
    }
  });

  test("with the switch off, the order stays aguardando, also with auto_accept on", async () => {
    const prepared = await preparePublicOrder(deps, publicId, order());
    await simulateInboundMessage(deps, admin(), { phone: nextPhone(), body: prepared.whatsappText });
    const placed = await convertedOrder(prepared.reference);
    expect(placed?.status).toBe("aguardando");
    // FR-241: an order that waits for a person keeps the restaurant's text.
    const [received] = await db<{ body: string }[]>`
      select body from public.messages where order_id = ${placed?.id ?? ""} and automatic_kind = 'order_received'`;
    expect(received?.body).toMatch(/^Recebemos o pedido ORD-\d+\.$/);
  });
});

describe("rate limit (FR-235)", () => {
  test("the restaurant is limited per minute", async () => {
    // A minute of its own, so the earlier tests do not count.
    const later = createTestServiceDeps(db, { clock: new FixedClock("2026-10-13T15:07:00Z") });
    for (let i = 0; i < PUBLIC_ORDER_LIMITS.restaurant; i += 1) {
      await preparePublicOrder(later, publicId, order());
    }
    expect(code(await caught(() => preparePublicOrder(later, publicId, order())))).toBe("rate_limited");
  });

  test("one visitor is limited per minute without spending the restaurant budget", async () => {
    const later = createTestServiceDeps(db, { clock: new FixedClock("2026-10-13T15:09:00Z") });
    for (let i = 0; i < PUBLIC_ORDER_LIMITS.client; i += 1) {
      await preparePublicOrder(later, publicId, order(), "203.0.113.7");
    }
    const refused = await caught(() => preparePublicOrder(later, publicId, order(), "203.0.113.7"));
    expect(code(refused)).toBe("rate_limited");
    // Another visitor still checks out, and the refused call did not count for the restaurant.
    await preparePublicOrder(later, publicId, order(), "198.51.100.2");
    const [row] = await db<{ count: number }[]>`
      select count from public.rate_counters
      where subject_id = ${a.restaurantId} and class = 'menu_order' and window_start = '2026-10-13T15:09:00Z'`;
    expect(row?.count).toBe(PUBLIC_ORDER_LIMITS.client + 1);
  });

  test("the visitor counter stores a hash of the address, never the address", async () => {
    const rows = await db<{ subject_id: string }[]>`
      select subject_id::text from public.rate_counters where class = 'menu_order_client'`;
    // subject_id is a uuid column, so it cannot hold an address; the subject is the hash.
    expect(rows.map((r) => r.subject_id)).toContain(clientRateSubject("203.0.113.7", a.restaurantId));
  });
});
