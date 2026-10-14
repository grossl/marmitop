// covers FR-020, FR-021, FR-022, FR-023, FR-024, FR-025, FR-026, FR-028, FR-029, FR-030, FR-032, FR-033, FR-034, FR-035, FR-037, FR-038, FR-008
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AppError } from "@mt/core";
import type { Db } from "@mt/db";
import { createTestDb, type RestaurantFixture, seedRestaurant } from "@mt/db/test-harness";

import type { ServiceDeps } from "../../deps";
import { createTestServiceDeps, userCtx } from "../../testing";
import { cancelOrder, changeOrderStatus } from "./change-status";
import { createOrder } from "./create-order";
import { lookupCustomers, quickCreateCustomer } from "./customer-lookup";
import { getOrder, getOrderKpis, getOrdersBoard, listOrders } from "./list-orders";
import { getOrderFormData } from "./order-form";

let db: Db;
let deps: ServiceDeps;
let a: RestaurantFixture;
let b: RestaurantFixture;

const code = (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`);
const att = () => userCtx(a.restaurantId, a.attendantId, "attendant");

// The test clock is Tuesday 2026-10-13 12:00 in America/Sao_Paulo.
const DAY = "2026-10-13";

beforeAll(async () => {
  db = await createTestDb();
  deps = createTestServiceDeps(db);
  a = await seedRestaurant(db, "orders-a");
  b = await seedRestaurant(db, "orders-b");
  await db`update public.restaurant_settings set delivery_fee_cents = 500 where restaurant_id = ${a.restaurantId}`;
});

afterAll(async () => {
  await db.end();
});

const base = (over: Record<string, unknown> = {}) => ({
  customerId: a.customerId,
  items: [{ menuItemId: a.menuItemId, sizeId: a.menuItemSizeId, qty: 2 }],
  fulfillment: "delivery" as const,
  paymentMethod: "pix" as const,
  source: "counter" as const,
  ...over,
});

describe("createOrder", () => {
  test("computes the total on the server and snapshots the items (FR-037, FR-038)", async () => {
    const created = await createOrder(deps, att(), base());
    expect(created.status).toBe("aguardando");
    expect(created.code).toMatch(/^ORD-\d{3,}$/);
    expect(created.totalCents).toBe(2 * 1890 + 500);
    const detail = await getOrder(deps, att(), { orderId: created.id });
    expect(detail.subtotalCents).toBe(3780);
    expect(detail.deliveryFeeCents).toBe(500);
    expect(detail.items[0]).toMatchObject({ name: "Frango Grelhado", sizeName: "M", unitPriceCents: 1890, qty: 2 });
    // FR-023: the first history row
    expect(detail.history).toHaveLength(1);
    expect(detail.history[0]).toMatchObject({ fromStatus: null, toStatus: "aguardando" });
  });

  test("copies the address from the customer and the city from the restaurant (FR-034, ADR-016)", async () => {
    const created = await createOrder(deps, att(), base());
    const detail = await getOrder(deps, att(), { orderId: created.id });
    expect(detail).toMatchObject({ logradouro: "Rua das Flores", bairro: "Vila Madalena", cidade: "São Paulo", uf: "SP" });
  });

  test("a pickup order has no delivery fee (FR-037)", async () => {
    const created = await createOrder(deps, att(), base({ fulfillment: "pickup" }));
    expect(created.totalCents).toBe(3780);
  });

  test("auto-accept starts the order as confirmado (FR-029)", async () => {
    await db`update public.restaurant_settings set auto_accept = true where restaurant_id = ${a.restaurantId}`;
    try {
      const created = await createOrder(deps, att(), base());
      expect(created.status).toBe("confirmado");
      const detail = await getOrder(deps, att(), { orderId: created.id });
      expect(detail.history[0]).toMatchObject({ fromStatus: null, toStatus: "confirmado" });
    } finally {
      await db`update public.restaurant_settings set auto_accept = false where restaurant_id = ${a.restaurantId}`;
    }
  });

  test("pickup is refused when the setting is off (FR-033)", async () => {
    await db`update public.restaurant_settings set allow_pickup = false where restaurant_id = ${a.restaurantId}`;
    try {
      expect(code(await createOrder(deps, att(), base({ fulfillment: "pickup" })).catch((e) => e))).toBe(
        "validation_failed",
      );
    } finally {
      await db`update public.restaurant_settings set allow_pickup = true where restaurant_id = ${a.restaurantId}`;
    }
  });

  test("an item off today's weekday is unavailable (FR-032)", async () => {
    await db`update public.menu_items set available_weekdays = '{0,1}' where id = ${a.menuItemId}`;
    try {
      expect(code(await createOrder(deps, att(), base()).catch((e) => e))).toBe("item_unavailable");
      const form = await getOrderFormData(deps, att(), undefined);
      expect(form.products.find((p) => p.id === a.menuItemId)).toBeUndefined();
    } finally {
      await db`update public.menu_items set available_weekdays = '{0,1,2,3,4,5,6}' where id = ${a.menuItemId}`;
    }
  });

  test("an item of another restaurant is unavailable (FR-008)", async () => {
    const error = await createOrder(deps, att(), base({ items: [{ menuItemId: b.menuItemId, sizeId: b.menuItemSizeId, qty: 1 }] })).catch((e) => e);
    expect(code(error)).toBe("item_unavailable");
  });

  test("a customer of another restaurant is refused (FR-008)", async () => {
    expect(code(await createOrder(deps, att(), base({ customerId: b.customerId })).catch((e) => e))).toBe(
      "validation_failed",
    );
  });

  test("change_for below the total is refused (FR-035)", async () => {
    const error = await createOrder(deps, att(), base({ paymentMethod: "dinheiro", changeForCents: 1000 })).catch((e) => e);
    expect(code(error)).toBe("validation_failed");
    const ok = await createOrder(deps, att(), base({ paymentMethod: "dinheiro", changeForCents: 5000 }));
    expect(ok.totalCents).toBe(4280);
  });

  test("the form data lists today's products with sizes (FR-032)", async () => {
    const form = await getOrderFormData(deps, att(), undefined);
    expect(form.weekday).toBe(2);
    expect(form.deliveryFeeCents).toBe(500);
    const item = form.products.find((p) => p.id === a.menuItemId);
    expect(item?.sizes.map((s) => s.name)).toEqual(["M"]);
  });

  test("codes increase per restaurant (FR-038)", async () => {
    const one = await createOrder(deps, userCtx(b.restaurantId, b.attendantId, "attendant"), {
      ...base({ customerId: b.customerId, items: [{ menuItemId: b.menuItemId, sizeId: b.menuItemSizeId, qty: 1 }] }),
    });
    const two = await createOrder(deps, userCtx(b.restaurantId, b.attendantId, "attendant"), {
      ...base({ customerId: b.customerId, items: [{ menuItemId: b.menuItemId, sizeId: b.menuItemSizeId, qty: 1 }] }),
    });
    expect(Number(two.code.slice(4))).toBe(Number(one.code.slice(4)) + 1);
  });
});

describe("changeOrderStatus / cancelOrder", () => {
  test("a forward skip writes one history row; a final status cannot move (FR-021, FR-022, FR-023, FR-028)", async () => {
    const o = await createOrder(deps, att(), base());
    const moved = await changeOrderStatus(deps, att(), { orderId: o.id, toStatus: "preparando" });
    expect(moved).toMatchObject({ status: "preparando", changed: true });
    const delivered = await changeOrderStatus(deps, att(), { orderId: o.id, toStatus: "entregue" });
    expect(delivered.deliveredAt).not.toBeNull();
    const back = await changeOrderStatus(deps, att(), { orderId: o.id, toStatus: "preparando" }).catch((e) => e);
    expect(code(back)).toBe("invalid_status_transition");
    const detail = await getOrder(deps, att(), { orderId: o.id });
    expect(detail.history.map((h) => h.toStatus)).toEqual(["aguardando", "preparando", "entregue"]);
  });

  test("the same status is a no-op without history (FR-022)", async () => {
    const o = await createOrder(deps, att(), base());
    const r = await changeOrderStatus(deps, att(), { orderId: o.id, toStatus: "aguardando" });
    expect(r.changed).toBe(false);
    expect((await getOrder(deps, att(), { orderId: o.id })).history).toHaveLength(1);
  });

  test("a pickup order never enters saiu (FR-022)", async () => {
    const o = await createOrder(deps, att(), base({ fulfillment: "pickup" }));
    const r = await changeOrderStatus(deps, att(), { orderId: o.id, toStatus: "saiu" }).catch((e) => e);
    expect(code(r)).toBe("invalid_status_transition");
  });

  test("cancel keeps the order and records the reason (FR-026)", async () => {
    const o = await createOrder(deps, att(), base());
    await changeOrderStatus(deps, att(), { orderId: o.id, toStatus: "preparando" });
    const r = await cancelOrder(deps, att(), { orderId: o.id, reason: "Cliente desistiu" });
    expect(r).toMatchObject({ status: "cancelado", changed: true });
    const detail = await getOrder(deps, att(), { orderId: o.id });
    expect(detail).toMatchObject({ status: "cancelado", cancelReason: "Cliente desistiu" });
    expect(detail.cancelledAt).not.toBeNull();
    expect(detail.history.at(-1)).toMatchObject({ fromStatus: "preparando", toStatus: "cancelado" });
  });

  test("cancelling a delivered order is rejected (FR-026)", async () => {
    const o = await createOrder(deps, att(), base());
    await changeOrderStatus(deps, att(), { orderId: o.id, toStatus: "entregue" });
    expect(code(await cancelOrder(deps, att(), { orderId: o.id }).catch((e) => e))).toBe("invalid_status_transition");
  });

  test("an order of another restaurant is not found (FR-008)", async () => {
    expect(code(await changeOrderStatus(deps, att(), { orderId: b.orderId, toStatus: "confirmado" }).catch((e) => e))).toBe(
      "not_found",
    );
  });

  test("an unknown role claim matches nothing (RLS second line)", async () => {
    // an attendant of A naming restaurant B in the context sees no order of B
    const ctx = userCtx(b.restaurantId, a.attendantId, "attendant");
    expect(code(await changeOrderStatus(deps, ctx, { orderId: b.orderId, toStatus: "confirmado" }).catch((e) => e))).toBe(
      "not_found",
    );
  });
});

describe("listOrders / getOrderKpis", () => {
  test("search matches code, customer name, and item name (FR-024)", async () => {
    const o = await createOrder(deps, att(), base());
    for (const q of [o.code, "Mari", "Frango"]) {
      const rows = await listOrders(deps, att(), { q, day: DAY });
      expect(rows.some((r) => r.id === o.id)).toBe(true);
    }
    expect((await listOrders(deps, att(), { q: "zzz-nothing", day: DAY })).length).toBe(0);
    // % is a literal, not a wildcard
    expect((await listOrders(deps, att(), { q: "%", day: DAY })).length).toBe(0);
  });

  test("the board load returns today's orders, KPIs, and the timezone (FR-020, FR-025)", async () => {
    const o = await createOrder(deps, att(), base());
    const board = await getOrdersBoard(deps, att(), undefined);
    expect(board.day).toBe(DAY);
    expect(board.timezone).toBe("America/Sao_Paulo");
    expect(board.orders.some((r) => r.id === o.id)).toBe(true);
    const mine = board.orders.find((r) => r.id === o.id);
    expect(mine?.allowedStatuses).toContain("preparando");
  });

  test("the board never shows another restaurant's orders (FR-008)", async () => {
    const rows = await listOrders(deps, att(), { day: DAY });
    expect(rows.every((r) => r.id !== b.orderId)).toBe(true);
  });

  test("KPIs count today's delivered revenue only (FR-025, ADR-015)", async () => {
    const before = await getOrderKpis(deps, att(), { day: DAY });
    const o = await createOrder(deps, att(), base({ fulfillment: "pickup" }));
    await changeOrderStatus(deps, att(), { orderId: o.id, toStatus: "entregue" });
    const after = await getOrderKpis(deps, att(), { day: DAY });
    expect(after.deliveredRevenueCents - before.deliveredRevenueCents).toBe(3780);
    expect(after.deliveredCount - before.deliveredCount).toBe(1);
    // an order delivered yesterday does not count
    await db`update public.orders set delivered_at = '2026-10-12T15:00:00Z' where id = ${o.id}`;
    const yesterday = await getOrderKpis(deps, att(), { day: DAY });
    expect(yesterday.deliveredCount).toBe(before.deliveredCount);
  });

  test("in-progress, ready, and out-for-delivery counts follow the status (FR-025)", async () => {
    const before = await getOrderKpis(deps, att(), { day: DAY });
    const o = await createOrder(deps, att(), base());
    const mid = await getOrderKpis(deps, att(), { day: DAY });
    expect(mid.inProgressCount - before.inProgressCount).toBe(1);
    await changeOrderStatus(deps, att(), { orderId: o.id, toStatus: "pronto" });
    const ready = await getOrderKpis(deps, att(), { day: DAY });
    expect(ready.readyCount - before.readyCount).toBe(1);
    await changeOrderStatus(deps, att(), { orderId: o.id, toStatus: "saiu" });
    const out = await getOrderKpis(deps, att(), { day: DAY });
    expect(out.outForDeliveryCount - before.outForDeliveryCount).toBe(1);
  });
});

describe("customers for the order screen", () => {
  test("quick-create takes a name and a phone; a duplicate phone conflicts (FR-030)", async () => {
    const c = await quickCreateCustomer(deps, att(), { name: "Joana", phone: "(11) 91234-5678" });
    expect(c.phone).toBe("+5511912345678");
    expect(code(await quickCreateCustomer(deps, att(), { name: "Outra", phone: "11912345678" }).catch((e) => e))).toBe(
      "conflict",
    );
    const found = await lookupCustomers(deps, att(), { q: "Joan" });
    expect(found.map((f) => f.id)).toContain(c.id);
  });

  test("the picker finds customers of this restaurant only; pinned ids come first (FR-008)", async () => {
    const found = await lookupCustomers(deps, att(), { q: "Maria", ids: [a.customerId] });
    expect(found[0]?.id).toBe(a.customerId);
    const other = await lookupCustomers(deps, att(), { ids: [b.customerId] });
    expect(other.some((c) => c.id === b.customerId)).toBe(false);
  });
});
