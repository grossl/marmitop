// covers FR-060, FR-061, FR-062, FR-063, FR-064, FR-065, FR-066, FR-067, FR-068, FR-006, NFR-001
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AppError } from "@mt/core";
import type { Db } from "@mt/db";
import { createTestDb, type RestaurantFixture, seedRestaurant } from "@mt/db/test-harness";

import type { ServiceDeps } from "../../deps";
import { createTestServiceDeps, userCtx } from "../../testing";
import {
  archiveStockItem,
  isLowStock,
  listStockItems,
  listStockMovements,
  recordStockMovement,
  saveStockItem,
  stockValueCents,
} from "./stock";

let db: Db;
let deps: ServiceDeps;
let a: RestaurantFixture;
let b: RestaurantFixture;
let admin: ReturnType<typeof userCtx>;
let attendant: ReturnType<typeof userCtx>;

const code = (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`);

beforeAll(async () => {
  db = await createTestDb();
  deps = createTestServiceDeps(db);
  a = await seedRestaurant(db, "stock-a");
  b = await seedRestaurant(db, "stock-b");
  admin = userCtx(a.restaurantId, a.adminId, "admin");
  attendant = userCtx(a.restaurantId, a.attendantId, "attendant");
});

afterAll(async () => {
  await db.end();
});

describe("pure helpers", () => {
  test("low means at or below the minimum", () => {
    expect(isLowStock(5, 5)).toBe(true);
    expect(isLowStock(5.001, 5)).toBe(false);
  });
  test("value rounds quantity times unit cost", () => {
    expect(stockValueCents(2.5, 333)).toBe(833);
  });
});

describe("saveStockItem", () => {
  test("creating with an initial quantity records an `in` movement", async () => {
    const item = await saveStockItem(deps, admin, {
      name: "Arroz",
      unit: "kg",
      category: "insumos",
      minimumQty: 10,
      unitCostCents: 650,
      initialQty: 18,
    });
    expect(item).toMatchObject({ currentQty: 18, minimumQty: 10, low: false });
    const history = await listStockMovements(deps, admin, { stockItemId: item.id });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ kind: "in", qty: 18, balanceAfter: 18 });
  });

  test("the quantity cannot be edited: currentQty is refused and initialQty with an id too", async () => {
    const item = await saveStockItem(deps, admin, {
      name: "Sal",
      unit: "kg",
      category: "insumos",
      minimumQty: 1,
      unitCostCents: 300,
    });
    const e1 = await saveStockItem(deps, admin, {
      id: item.id,
      name: "Sal",
      unit: "kg",
      category: "insumos",
      minimumQty: 1,
      unitCostCents: 300,
      currentQty: 99,
    } as never).catch((e) => e);
    expect(code(e1)).toBe("validation_failed");
    const e2 = await saveStockItem(deps, admin, {
      id: item.id,
      name: "Sal",
      unit: "kg",
      category: "insumos",
      minimumQty: 1,
      unitCostCents: 300,
      initialQty: 5,
    }).catch((e) => e);
    expect(code(e2)).toBe("validation_failed");
  });

  test("an update changes the fields and leaves the quantity alone", async () => {
    const item = await saveStockItem(deps, admin, {
      name: "Óleo",
      unit: "l",
      category: "insumos",
      minimumQty: 2,
      unitCostCents: 900,
      initialQty: 4,
    });
    const updated = await saveStockItem(deps, admin, {
      id: item.id,
      name: "Óleo de soja",
      unit: "l",
      category: "insumos",
      minimumQty: 3,
      unitCostCents: 950,
    });
    expect(updated).toMatchObject({ name: "Óleo de soja", minimumQty: 3, unitCostCents: 950, currentQty: 4 });
  });

  test("an attendant is refused", async () => {
    const error = await saveStockItem(deps, attendant, {
      name: "X",
      unit: "un",
      category: "insumos",
      minimumQty: 0,
      unitCostCents: 0,
    }).catch((e) => e);
    expect(code(error)).toBe("forbidden");
  });
});

describe("recordStockMovement", () => {
  test("in, out, and adjust move the balance through the trigger", async () => {
    const item = await saveStockItem(deps, admin, {
      name: "Feijão",
      unit: "kg",
      category: "insumos",
      minimumQty: 8,
      unitCostCents: 890,
      initialQty: 10,
    });
    expect(await recordStockMovement(deps, admin, { stockItemId: item.id, kind: "in", qty: 5.5 })).toMatchObject({
      balanceAfter: 15.5,
    });
    expect(
      await recordStockMovement(deps, admin, { stockItemId: item.id, kind: "out", qty: 3, reason: "Produção" }),
    ).toMatchObject({ balanceAfter: 12.5 });
    expect(
      await recordStockMovement(deps, admin, { stockItemId: item.id, kind: "adjust", qty: -2.5, reason: "Contagem" }),
    ).toMatchObject({ balanceAfter: 10 });
    const history = await listStockMovements(deps, admin, { stockItemId: item.id });
    expect(history.map((m) => m.kind)).toEqual(["adjust", "out", "in", "in"]);
    const [row] = await db<{ current_qty: string }[]>`select current_qty from public.stock_items where id = ${item.id}`;
    expect(Number(row?.current_qty)).toBe(10);
  });

  test("an out larger than the stock is refused and changes nothing", async () => {
    const item = await saveStockItem(deps, admin, {
      name: "Tampa",
      unit: "un",
      category: "embalagens",
      minimumQty: 0,
      unitCostCents: 35,
      initialQty: 2,
    });
    const error = await recordStockMovement(deps, admin, { stockItemId: item.id, kind: "out", qty: 3 }).catch((e) => e);
    expect(code(error)).toBe("validation_failed");
    const history = await listStockMovements(deps, admin, { stockItemId: item.id });
    expect(history).toHaveLength(1);
  });

  test("a zero adjust and a non-positive in are refused", async () => {
    const item = await saveStockItem(deps, admin, {
      name: "Copo",
      unit: "un",
      category: "embalagens",
      minimumQty: 0,
      unitCostCents: 10,
      initialQty: 5,
    });
    expect(
      code(await recordStockMovement(deps, admin, { stockItemId: item.id, kind: "adjust", qty: 0 }).catch((e) => e)),
    ).toBe("validation_failed");
    expect(
      code(await recordStockMovement(deps, admin, { stockItemId: item.id, kind: "in", qty: -1 }).catch((e) => e)),
    ).toBe("validation_failed");
  });

  test("an attendant is refused and restaurant B cannot move A's item", async () => {
    const item = await saveStockItem(deps, admin, {
      name: "Guardanapo",
      unit: "un",
      category: "embalagens",
      minimumQty: 0,
      unitCostCents: 5,
      initialQty: 5,
    });
    expect(
      code(await recordStockMovement(deps, attendant, { stockItemId: item.id, kind: "in", qty: 1 }).catch((e) => e)),
    ).toBe("forbidden");
    const other = userCtx(b.restaurantId, b.adminId, "admin");
    expect(
      code(await recordStockMovement(deps, other, { stockItemId: item.id, kind: "in", qty: 1 }).catch((e) => e)),
    ).toBe("not_found");
  });
});

describe("listStockItems and archiveStockItem", () => {
  test("flags low items and totals the value over active items", async () => {
    const fresh = await seedRestaurant(db, "stock-totals");
    const ctx = userCtx(fresh.restaurantId, fresh.adminId, "admin");
    await saveStockItem(deps, ctx, {
      name: "A",
      unit: "kg",
      category: "insumos",
      minimumQty: 10,
      unitCostCents: 100,
      initialQty: 5,
    });
    await saveStockItem(deps, ctx, {
      name: "B",
      unit: "kg",
      category: "insumos",
      minimumQty: 1,
      unitCostCents: 250,
      initialQty: 2.5,
    });
    const list = await listStockItems(deps, ctx, {});
    expect(list.lowCount).toBe(1);
    expect(list.totalValueCents).toBe(500 + 625);
    expect(list.items.find((i) => i.name === "A")?.low).toBe(true);
    expect((await listStockItems(deps, ctx, { category: "bebidas" })).items).toHaveLength(0);
  });

  test("archiving hides the item from lists and totals but keeps its history", async () => {
    const fresh = await seedRestaurant(db, "stock-archive");
    const ctx = userCtx(fresh.restaurantId, fresh.adminId, "admin");
    const item = await saveStockItem(deps, ctx, {
      name: "Velho",
      unit: "un",
      category: "insumos",
      minimumQty: 0,
      unitCostCents: 100,
      initialQty: 3,
    });
    await archiveStockItem(deps, ctx, { id: item.id });
    const list = await listStockItems(deps, ctx, {});
    expect(list.items.some((i) => i.id === item.id)).toBe(false);
    expect(list.totalValueCents).toBe(0);
    const [counted] = await db<
      { n: number }[]
    >`select count(*)::int as n from public.stock_movements where stock_item_id = ${item.id}`;
    expect(counted?.n).toBe(1);
    expect(code(await archiveStockItem(deps, ctx, { id: item.id }).catch((e) => e))).toBe("not_found");
  });

  test("an attendant cannot list stock", async () => {
    expect(code(await listStockItems(deps, attendant, {}).catch((e) => e))).toBe("forbidden");
  });
});
