// covers FR-060, FR-061, FR-062, FR-063, FR-067
import { describe, expect, test } from "bun:test";
import { listStockQuerySchema, recordStockMovementSchema, saveStockItemSchema } from "./stock";

const ID = "3f6c1a0e-7a3b-4b1e-9c53-1f3f6d0f6a11";

describe("saveStockItemSchema", () => {
  const item = { name: "Arroz", unit: "kg", category: "insumos", minimumQty: 10, unitCostCents: 650 };
  test("accepts a valid item; creation may carry an initial quantity (FR-061)", () => {
    expect(saveStockItemSchema.safeParse(item).success).toBe(true);
    expect(saveStockItemSchema.parse({ ...item, initialQty: 25.5 }).initialQty).toBe(25.5);
  });
  test("all fields are required", () => {
    for (const key of ["name", "unit", "category", "minimumQty", "unitCostCents"] as const) {
      const { [key]: _omit, ...rest } = item;
      expect(saveStockItemSchema.safeParse(rest).success).toBe(false);
    }
  });
  test("category is insumos, embalagens, or bebidas", () => {
    expect(saveStockItemSchema.safeParse({ ...item, category: "limpeza" }).success).toBe(false);
  });
  test("quantities are non-negative with at most 3 decimals; cost is integer cents", () => {
    expect(saveStockItemSchema.safeParse({ ...item, minimumQty: -1 }).success).toBe(false);
    expect(saveStockItemSchema.safeParse({ ...item, minimumQty: 1.2345 }).success).toBe(false);
    expect(saveStockItemSchema.safeParse({ ...item, minimumQty: 1.234 }).success).toBe(true);
    expect(saveStockItemSchema.safeParse({ ...item, unitCostCents: 6.5 }).success).toBe(false);
  });
  test("direct quantity edits are impossible (FR-067): current_qty is rejected", () => {
    expect(saveStockItemSchema.safeParse({ ...item, id: ID, currentQty: 99 }).success).toBe(false);
    expect(saveStockItemSchema.safeParse({ ...item, id: ID, initialQty: 5 }).success).toBe(false);
  });
});

describe("recordStockMovementSchema", () => {
  test("in and out take a positive quantity", () => {
    expect(recordStockMovementSchema.safeParse({ stockItemId: ID, kind: "in", qty: 5, reason: "compra" }).success).toBe(
      true,
    );
    expect(recordStockMovementSchema.safeParse({ stockItemId: ID, kind: "out", qty: 2 }).success).toBe(true);
    for (const kind of ["in", "out"] as const) {
      expect(recordStockMovementSchema.safeParse({ stockItemId: ID, kind, qty: 0 }).success).toBe(false);
      expect(recordStockMovementSchema.safeParse({ stockItemId: ID, kind, qty: -3 }).success).toBe(false);
    }
  });
  test("adjust takes a signed non-zero delta", () => {
    expect(recordStockMovementSchema.safeParse({ stockItemId: ID, kind: "adjust", qty: -2.5 }).success).toBe(true);
    expect(recordStockMovementSchema.safeParse({ stockItemId: ID, kind: "adjust", qty: 4 }).success).toBe(true);
    expect(recordStockMovementSchema.safeParse({ stockItemId: ID, kind: "adjust", qty: 0 }).success).toBe(false);
  });
  test("at most 3 decimals, a valid kind and item id, reason up to 200 characters", () => {
    expect(recordStockMovementSchema.safeParse({ stockItemId: ID, kind: "in", qty: 1.2345 }).success).toBe(false);
    expect(recordStockMovementSchema.safeParse({ stockItemId: ID, kind: "move", qty: 1 }).success).toBe(false);
    expect(recordStockMovementSchema.safeParse({ stockItemId: "x", kind: "in", qty: 1 }).success).toBe(false);
    expect(
      recordStockMovementSchema.safeParse({ stockItemId: ID, kind: "in", qty: 1, reason: "x".repeat(201) }).success,
    ).toBe(false);
  });
});

describe("listStockQuerySchema", () => {
  test("q and category", () => {
    expect(listStockQuerySchema.parse({ q: "arroz", category: "insumos" })).toEqual({
      q: "arroz",
      category: "insumos",
    });
    expect(listStockQuerySchema.safeParse({ category: "x" }).success).toBe(false);
  });
});
