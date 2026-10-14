// covers FR-070, FR-071, FR-072, FR-073, FR-074, FR-075, FR-076, FR-077, FR-078, FR-079, ADR-015
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AppError } from "@mt/core";
import type { Db } from "@mt/db";
import { createTestDb, type RestaurantFixture, seedRestaurant } from "@mt/db/test-harness";

import type { ServiceDeps } from "../../deps";
import { createTestServiceDeps, userCtx } from "../../testing";
import { getReportPeriodDefault, getReports } from "./reports";

let db: Db;
let deps: ServiceDeps;
let a: RestaurantFixture;
let b: RestaurantFixture;

const code = (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`);

async function seedOrder(
  f: RestaurantFixture,
  orderCode: string,
  customerId: string,
  status: string,
  deliveredAt: string | null,
  items: { name: string; qty: number; priceCents: number }[],
) {
  const subtotal = items.reduce((s, i) => s + i.qty * i.priceCents, 0);
  await db.begin(async (tx) => {
    const [o] = await tx<{ id: string }[]>`
      insert into public.orders
        (restaurant_id, code, customer_id, status, fulfillment, payment_method, subtotal_cents, delivery_fee_cents,
         total_cents, source, delivered_at, cancelled_at)
      values (${f.restaurantId}, ${orderCode}, ${customerId}, ${status}, 'pickup', 'pix', ${subtotal}, 0, ${subtotal},
              'counter', ${deliveredAt}, ${status === "cancelado" ? new Date() : null})
      returning id`;
    for (const [i, it] of items.entries()) {
      await tx`
        insert into public.order_items (restaurant_id, order_id, name, unit_price_cents, qty, position)
        values (${f.restaurantId}, ${o?.id}, ${it.name}, ${it.priceCents}, ${it.qty}, ${i})`;
    }
  });
}

beforeAll(async () => {
  db = await createTestDb();
  deps = createTestServiceDeps(db); // clock: 2026-10-13T15:00:00Z
  a = await seedRestaurant(db, "reports-a");
  b = await seedRestaurant(db, "reports-b");
  const [c2] = await db<{ id: string }[]>`
    insert into public.customers (restaurant_id, name, phone)
    values (${a.restaurantId}, 'João', '+5511900000001') returning id`;
  const c2id = c2?.id as string;
  await seedOrder(a, "ORD-101", a.customerId, "entregue", "2026-10-10T15:00:00Z", [{ name: "Frango", qty: 2, priceCents: 1500 }]);
  await seedOrder(a, "ORD-102", c2id, "entregue", "2026-10-12T15:00:00Z", [
    { name: "Frango", qty: 1, priceCents: 1000 },
    { name: "Suco", qty: 1, priceCents: 1000 },
  ]);
  await seedOrder(a, "ORD-103", c2id, "confirmado", null, [{ name: "Frango", qty: 9, priceCents: 1000 }]);
  await seedOrder(a, "ORD-104", a.customerId, "entregue", "2026-09-20T15:00:00Z", [{ name: "Frango", qty: 1, priceCents: 4000 }]);
  // Restaurant B has a delivered order that A must never see.
  await seedOrder(b, "ORD-201", b.customerId, "entregue", "2026-10-11T15:00:00Z", [{ name: "Bife", qty: 5, priceCents: 9000 }]);
});

afterAll(async () => {
  await db.end();
});

describe("getReports", () => {
  const period = { from: "2026-10-01", to: "2026-10-13" };

  test("summary counts delivered orders only, in the period", async () => {
    const r = await getReports(deps, userCtx(a.restaurantId, a.adminId, "admin"), period);
    expect(r.summary).toEqual({ revenueCents: 5000, orderCount: 2, averageTicketCents: 2500, activeCustomers: 2 });
  });

  test("monthly revenue covers six months, current last, with order counts", async () => {
    const r = await getReports(deps, userCtx(a.restaurantId, a.adminId, "admin"), period);
    expect(r.monthly).toHaveLength(6);
    expect(r.monthly.at(-1)).toMatchObject({ month: "2026-10", revenueCents: 5000, orderCount: 2, averageTicketCents: 2500 });
    expect(r.monthly.at(-2)).toMatchObject({ month: "2026-09", revenueCents: 4000, orderCount: 1 });
    expect(r.monthly[0]).toMatchObject({ month: "2026-05", revenueCents: 0, orderCount: 0 });
    expect(r.revenueGrowthPercent).toBe(25);
  });

  test("daily orders cover 14 days, today last", async () => {
    const r = await getReports(deps, userCtx(a.restaurantId, a.adminId, "admin"), period);
    expect(r.daily).toHaveLength(14);
    expect(r.daily.at(-1)?.day).toBe("2026-10-13");
    expect(r.daily.find((d) => d.day === "2026-10-10")?.orders).toBe(1);
  });

  test("top items sum quantity from delivered orders in the period", async () => {
    const r = await getReports(deps, userCtx(a.restaurantId, a.adminId, "admin"), period);
    expect(r.topItems).toEqual([
      { name: "Frango", qty: 3 },
      { name: "Suco", qty: 1 },
    ]);
  });

  test("another restaurant's orders never leak in", async () => {
    const r = await getReports(deps, userCtx(b.restaurantId, b.adminId, "admin"), period);
    expect(r.summary.revenueCents).toBe(45000);
    expect(r.topItems).toEqual([{ name: "Bife", qty: 5 }]);
  });

  test("an attendant is refused", async () => {
    const e = await getReports(deps, userCtx(a.restaurantId, a.attendantId, "attendant"), period).catch((x) => x);
    expect(code(e)).toBe("forbidden");
  });

  test("a period longer than 366 days is invalid", async () => {
    const e = await getReports(deps, userCtx(a.restaurantId, a.adminId, "admin"), {
      from: "2024-01-01",
      to: "2026-01-01",
    }).catch((x) => x);
    expect(code(e)).toBe("validation_failed");
  });
});

describe("getReportPeriodDefault", () => {
  test("is the first of the local month through today", async () => {
    const d = await getReportPeriodDefault(deps, userCtx(a.restaurantId, a.adminId, "admin"), undefined);
    expect(d).toMatchObject({ from: "2026-10-01", to: "2026-10-13", today: "2026-10-13" });
  });

  test("an attendant is refused", async () => {
    const e = await getReportPeriodDefault(deps, userCtx(a.restaurantId, a.attendantId, "attendant"), undefined).catch(
      (x) => x,
    );
    expect(code(e)).toBe("forbidden");
  });
});
