// covers FR-230, FR-231, FR-232, FR-233, FR-234, FR-235, FR-236, FR-238, FR-239, ADR-006, ADR-032, NFR-001
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AppError, FixedClock } from "@mt/core";
import type { Db } from "@mt/db";
import { createTestDb, type RestaurantFixture, seedRestaurant } from "@mt/db/test-harness";

import type { ServiceDeps } from "../../deps";
import { createTestServiceDeps, userCtx } from "../../testing";
import { saveMenuItem } from "../catalog/menu";
import { getPublicMenu } from "../catalog/public-menu";
import { simulateInboundMessage } from "../messaging";
import { PUBLIC_ORDER_LIMITS, type PublicOrderInput, placePublicOrder } from "./place-public-order";

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
/** A fresh phone per order, so the per-phone limit only bites where a test wants it. */
function nextPhone(): string {
  phoneCounter += 1;
  return `(11) 98888-${String(1000 + phoneCounter)}`;
}

function order(overrides: Partial<PublicOrderInput> = {}): PublicOrderInput {
  return {
    name: "Ana Souza",
    phone: nextPhone(),
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

describe("getPublicMenu ordering fields", () => {
  test("returns the fee, pickup, open state, and size ids", async () => {
    const menu = await getPublicMenu(deps, publicId);
    expect(menu).toMatchObject({ allowPickup: true, deliveryFeeCents: 500, openNow: true });
    const sizedItem = menu?.items.find((i) => i.id === sizedId);
    expect(sizedItem?.sizes.map((s) => s.id)).toContain(sizeGId);
  });
});

describe("placePublicOrder", () => {
  test("creates an aguardando order with source menu and the server total", async () => {
    const created = await placePublicOrder(
      deps,
      publicId,
      order({
        items: [
          { menuItemId: mealId, qty: 2 },
          { menuItemId: sizedId, sizeId: sizeGId, qty: 1 },
        ],
      }),
    );
    expect(created.status).toBe("aguardando");
    expect(created.totalCents).toBe(2 * 1890 + 2200 + 500);
    const [row] = await db<{ source: string; status: string; conversation_id: string | null; logradouro: string }[]>`
      select source, status, conversation_id, logradouro from public.orders where id = ${created.id}`;
    expect(row).toEqual({ source: "menu", status: "aguardando", conversation_id: null, logradouro: "Rua das Flores" });
    // FR-238: the WhatsApp text carries the code and the database prices.
    expect(created.whatsappText).toContain(`*Pedido ${created.code}*`);
    expect(created.whatsappText).toContain("2x Frango Público — R$ 37,80");
    expect(created.whatsappText).toContain("1x Executiva Pública (G) — R$ 22,00");
    expect(created.whatsappText).toContain("*Total: R$ 64,80*");
    expect(created.whatsappText).toContain("Rua das Flores, 10");
  });

  test("a client price is not accepted", async () => {
    const tampered = order({ items: [{ menuItemId: mealId, qty: 1, priceCents: 1 } as never] });
    expect(code(await caught(() => placePublicOrder(deps, publicId, tampered)))).toBe("validation_failed");
  });

  test("a new phone creates the customer with the name and address", async () => {
    await placePublicOrder(deps, publicId, order({ name: "Bruno Lima" }));
    const [c] = await db<{ name: string; logradouro: string; bairro: string }[]>`
      select name, logradouro, bairro from public.customers
      where restaurant_id = ${a.restaurantId} and name = 'Bruno Lima'`;
    expect(c).toMatchObject({ name: "Bruno Lima", logradouro: "Rua das Flores", bairro: "Centro" });
  });

  test("a known phone keeps the saved name and address", async () => {
    const phone = nextPhone();
    await placePublicOrder(deps, publicId, order({ phone, name: "Carla", logradouro: "Rua A", bairro: "Bairro A" }));
    const created = await placePublicOrder(
      deps,
      publicId,
      order({ phone, name: "Outra Pessoa", logradouro: "Rua B", bairro: "Bairro B" }),
    );
    const rows = await db<{ name: string; logradouro: string }[]>`
      select c.name, c.logradouro from public.customers c
      join public.orders o on o.customer_id = c.id and o.restaurant_id = c.restaurant_id
      where o.id = ${created.id}`;
    expect(rows[0]).toEqual({ name: "Carla", logradouro: "Rua A" });
    const [o] = await db<{ logradouro: string }[]>`select logradouro from public.orders where id = ${created.id}`;
    expect(o?.logradouro).toBe("Rua B");
  });

  test("delivery without rua or bairro is refused with field details", async () => {
    const e = await caught(() => placePublicOrder(deps, publicId, order({ logradouro: null, bairro: "" })));
    expect(code(e)).toBe("validation_failed");
    const paths = e instanceof AppError ? (e.details ?? []).map((d) => d.path) : [];
    expect(paths).toEqual(expect.arrayContaining(["logradouro", "bairro"]));
  });

  test("pickup needs no address", async () => {
    const created = await placePublicOrder(
      deps,
      publicId,
      order({ fulfillment: "pickup", logradouro: null, numero: null, bairro: null, paymentMethod: "dinheiro" }),
    );
    expect(created.totalCents).toBe(2 * 1890);
  });

  test("an unknown or malformed public id is not_found", async () => {
    expect(code(await caught(() => placePublicOrder(deps, "ffffffffffff", order())))).toBe("not_found");
    expect(code(await caught(() => placePublicOrder(deps, a.restaurantId, order())))).toBe("not_found");
  });

  test("a closed restaurant refuses the order", async () => {
    const lateDeps = createTestServiceDeps(db, { clock: new FixedClock("2026-10-14T03:00:00Z") }); // 00:00 local
    const e = await caught(() => placePublicOrder(lateDeps, publicId, order()));
    expect(code(e)).toBe("validation_failed");
    expect(detailCode(e)).toBe("restaurant_closed");
    expect((await getPublicMenu(lateDeps, publicId))?.openNow).toBe(false);
  });

  test("one phone is limited per minute", async () => {
    const phone = nextPhone();
    for (let i = 0; i < PUBLIC_ORDER_LIMITS.phone; i += 1) {
      await placePublicOrder(deps, publicId, order({ phone }));
    }
    expect(code(await caught(() => placePublicOrder(deps, publicId, order({ phone }))))).toBe("rate_limited");
  });
});

describe("WhatsApp handoff (ADR-032)", () => {
  const admin = () => userCtx(a.restaurantId, a.adminId, "admin");
  /** `nextPhone` is "(11) 98888-NNNN"; the gateway sends E.164. */
  const e164 = (phone: string) => `+55${phone.replace(/\D/g, "")}`;

  async function orderRow(id: string) {
    const [row] = await db<{ conversation_id: string | null }[]>`
      select conversation_id from public.orders where id = ${id}`;
    return row;
  }

  test("the first message from the order's phone links the order and sends order_received", async () => {
    await db`insert into public.ai_settings (restaurant_id, enabled) values (${a.restaurantId}, true)
             on conflict (restaurant_id) do update set enabled = true`;
    await db`insert into public.automatic_messages (restaurant_id, kind, enabled, body)
             values (${a.restaurantId}, 'order_received', true, 'Recebemos o pedido {{pedido}}.')
             on conflict (restaurant_id, kind) do update set enabled = true`;
    const phone = nextPhone();
    const created = await placePublicOrder(deps, publicId, order({ phone }));
    const sim = await simulateInboundMessage(deps, admin(), { phone: e164(phone), body: created.whatsappText });

    expect((await orderRow(created.id))?.conversation_id).toBe(sim.conversationId);
    expect(sim.automaticKind).toBe("order_received");
    const kinds = await db<{ automatic_kind: string; order_id: string | null }[]>`
      select automatic_kind, order_id from public.messages
      where conversation_id = ${sim.conversationId} and automatic_kind is not null`;
    expect([...kinds]).toEqual([{ automatic_kind: "order_received", order_id: created.id }]);
    // The AI would create the order again from the text: it pauses instead.
    const [conv] = await db<{ ai_mode: string; ai_pause_reason: string | null }[]>`
      select ai_mode, ai_pause_reason from public.conversations where id = ${sim.conversationId}`;
    expect(conv).toEqual({ ai_mode: "paused", ai_pause_reason: "attendant" });
    const [jobs] = await db<{ n: number }[]>`
      select count(*)::int as n from pgmq.q_mt_ai_turns where message->>'conversationId' = ${sim.conversationId}`;
    expect(jobs?.n).toBe(0);
  });

  test("a message from another phone links nothing", async () => {
    const created = await placePublicOrder(deps, publicId, order());
    await simulateInboundMessage(deps, admin(), { phone: e164(nextPhone()), body: created.whatsappText });
    expect((await orderRow(created.id))?.conversation_id).toBeNull();
  });

  test("an order older than 24 hours is not linked", async () => {
    const phone = nextPhone();
    const created = await placePublicOrder(deps, publicId, order({ phone }));
    await db`update public.orders set created_at = created_at - interval '25 hours' where id = ${created.id}`;
    await simulateInboundMessage(deps, admin(), { phone: e164(phone), body: "oi" });
    expect((await orderRow(created.id))?.conversation_id).toBeNull();
  });
});
