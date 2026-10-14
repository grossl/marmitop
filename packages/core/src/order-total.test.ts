// covers FR-030, FR-031, FR-032, FR-033, FR-034, FR-035, FR-036, FR-037, FR-038, NFR-041
import { describe, expect, test } from "bun:test";
import type { AppError } from "./errors";
import { computeOrderTotal, type MenuItemForOrder } from "./order-total";

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const marmitaFit: MenuItemForOrder = {
  id: "m1",
  kind: "meal",
  name: "Marmita Fit",
  priceCents: 2500,
  available: true,
  availableWeekdays: ALL_DAYS,
  sizes: [
    { id: "s-p", name: "P", priceCents: 2900 },
    { id: "s-g", name: "Grande", priceCents: 3900 },
  ],
};
const suco: MenuItemForOrder = {
  id: "d1",
  kind: "drink",
  name: "Suco de laranja",
  priceCents: 799,
  available: true,
  availableWeekdays: ALL_DAYS,
  sizes: [],
};
const menu = [marmitaFit, suco];

const base = { menu, weekday: 2, deliveryFeeCents: 600 };

function catchError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (e) {
    return e as AppError;
  }
  throw new Error("expected an error");
}

describe("computeOrderTotal", () => {
  test("pickup has zero fee: total = sum(unit_price x qty)", () => {
    const r = computeOrderTotal({
      ...base,
      fulfillment: "pickup",
      lines: [
        { menuItemId: "m1", sizeId: "s-g", qty: 2 },
        { menuItemId: "d1", qty: 3 },
      ],
    });
    expect(r.subtotalCents).toBe(3900 * 2 + 799 * 3);
    expect(r.deliveryFeeCents).toBe(0);
    expect(r.totalCents).toBe(7800 + 2397);
  });

  test("delivery adds the fee once", () => {
    const r = computeOrderTotal({
      ...base,
      fulfillment: "delivery",
      lines: [{ menuItemId: "m1", sizeId: "s-g", qty: 2, notes: "sem cebola" }],
    });
    expect(r.subtotalCents).toBe(7800);
    expect(r.deliveryFeeCents).toBe(600);
    expect(r.totalCents).toBe(8400);
  });

  test("uses the size price, not the base price, and snapshots names", () => {
    const r = computeOrderTotal({
      ...base,
      fulfillment: "pickup",
      lines: [
        { menuItemId: "m1", sizeId: "s-p", qty: 1 },
        { menuItemId: "m1", sizeId: "s-g", qty: 1 },
      ],
    });
    expect(r.items).toEqual([
      {
        menuItemId: "m1",
        name: "Marmita Fit",
        sizeName: "P",
        unitPriceCents: 2900,
        qty: 1,
        lineTotalCents: 2900,
        notes: null,
        position: 0,
      },
      {
        menuItemId: "m1",
        name: "Marmita Fit",
        sizeName: "Grande",
        unitPriceCents: 3900,
        qty: 1,
        lineTotalCents: 3900,
        notes: null,
        position: 1,
      },
    ]);
    expect(r.totalCents).toBe(6800);
  });

  test("item without sizes uses the base price", () => {
    const r = computeOrderTotal({ ...base, fulfillment: "pickup", lines: [{ menuItemId: "d1", qty: 1 }] });
    expect(r.items[0]?.unitPriceCents).toBe(799);
    expect(r.items[0]?.sizeName).toBeNull();
  });

  test("ignores a tampered client price", () => {
    const tampered = { menuItemId: "d1", qty: 1, unitPriceCents: 1, priceCents: 1, price: 0.01 };
    const r = computeOrderTotal({ ...base, fulfillment: "pickup", lines: [tampered] });
    expect(r.totalCents).toBe(799);
  });

  test("integer cents stay exact for awkward quantities", () => {
    const r = computeOrderTotal({
      ...base,
      menu: [{ ...suco, priceCents: 1099 }],
      fulfillment: "delivery",
      deliveryFeeCents: 1,
      lines: [{ menuItemId: "d1", qty: 99 }],
    });
    expect(r.totalCents).toBe(1099 * 99 + 1);
    expect(Number.isInteger(r.totalCents)).toBe(true);
  });

  test("rejects an empty cart", () => {
    const e = catchError(() => computeOrderTotal({ ...base, fulfillment: "pickup", lines: [] }));
    expect(e.code).toBe("validation_failed");
    expect(e.details?.[0]?.path).toBe("items");
  });

  test("rejects an unavailable item", () => {
    const e = catchError(() =>
      computeOrderTotal({
        ...base,
        menu: [{ ...suco, available: false }],
        fulfillment: "pickup",
        lines: [{ menuItemId: "d1", qty: 1 }],
      }),
    );
    expect(e.code).toBe("item_unavailable");
    expect(e.details?.[0]).toMatchObject({ path: "items[0].menu_item_id", code: "item_unavailable" });
  });

  test("rejects an item not offered on the weekday", () => {
    const e = catchError(() =>
      computeOrderTotal({
        ...base,
        weekday: 2,
        menu: [{ ...suco, availableWeekdays: [0, 1, 3, 4, 5, 6] }],
        fulfillment: "pickup",
        lines: [{ menuItemId: "d1", qty: 1 }],
      }),
    );
    expect(e.code).toBe("item_unavailable");
  });

  test("rejects an unknown item id (foreign or deleted)", () => {
    const e = catchError(() =>
      computeOrderTotal({ ...base, fulfillment: "pickup", lines: [{ menuItemId: "zzz", qty: 1 }] }),
    );
    expect(e.code).toBe("item_unavailable");
  });

  test("requires a size when the item has sizes", () => {
    const e = catchError(() =>
      computeOrderTotal({ ...base, fulfillment: "pickup", lines: [{ menuItemId: "m1", qty: 1 }] }),
    );
    expect(e.code).toBe("validation_failed");
    expect(e.details?.[0]).toMatchObject({ path: "items[0].size_id", code: "size_required" });
  });

  test("rejects a size that does not belong to the item, or a size on an item without sizes", () => {
    const wrong = catchError(() =>
      computeOrderTotal({ ...base, fulfillment: "pickup", lines: [{ menuItemId: "m1", sizeId: "nope", qty: 1 }] }),
    );
    expect(wrong.code).toBe("item_unavailable");
    const extra = catchError(() =>
      computeOrderTotal({ ...base, fulfillment: "pickup", lines: [{ menuItemId: "d1", sizeId: "s-p", qty: 1 }] }),
    );
    expect(extra.code).toBe("validation_failed");
  });

  test("rejects quantity outside 1..99 or non-integer", () => {
    for (const qty of [0, -1, 100, 1.5]) {
      const e = catchError(() =>
        computeOrderTotal({ ...base, fulfillment: "pickup", lines: [{ menuItemId: "d1", qty }] }),
      );
      expect(e.code).toBe("validation_failed");
      expect(e.details?.[0]?.path).toBe("items[0].qty");
    }
  });

  test("reports every bad line in details", () => {
    const e = catchError(() =>
      computeOrderTotal({
        ...base,
        fulfillment: "pickup",
        lines: [
          { menuItemId: "zzz", qty: 1 },
          { menuItemId: "d1", qty: 0 },
        ],
      }),
    );
    expect(e.details?.map((d) => d.path)).toEqual(["items[0].menu_item_id", "items[1].qty"]);
  });

  test("rejects a negative delivery fee", () => {
    const e = catchError(() =>
      computeOrderTotal({
        ...base,
        deliveryFeeCents: -1,
        fulfillment: "delivery",
        lines: [{ menuItemId: "d1", qty: 1 }],
      }),
    );
    expect(e.code).toBe("validation_failed");
  });

  test("a later price change leaves a stored snapshot unchanged", () => {
    const first = computeOrderTotal({ ...base, fulfillment: "pickup", lines: [{ menuItemId: "d1", qty: 2 }] });
    const repriced = computeOrderTotal({
      ...base,
      menu: [{ ...suco, priceCents: 5000 }],
      fulfillment: "pickup",
      lines: [{ menuItemId: "d1", qty: 2 }],
    });
    expect(first.totalCents).toBe(1598);
    expect(repriced.totalCents).toBe(10000);
    // the stored snapshot is plain data: recomputing never mutates it
    expect(first.items[0]?.unitPriceCents).toBe(799);
  });
});
