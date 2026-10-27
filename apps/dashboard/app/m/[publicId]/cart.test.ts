// covers FR-230
import { describe, expect, test } from "bun:test";
import type { PublicMenuItemDto } from "@mt/http";

import { cartTotals, parseCart, priceCart, qtyOf, setQty } from "./cart";

function item(overrides: Partial<PublicMenuItemDto>): PublicMenuItemDto {
  return {
    id: "meal",
    kind: "meal",
    name: "Frango",
    description: null,
    category: "proteinas",
    priceCents: 1890,
    calories: null,
    volume: null,
    popular: false,
    availableWeekdays: [0, 1, 2, 3, 4, 5, 6],
    imageUrl: null,
    sizes: [],
    ...overrides,
  };
}

const menu = [
  item({}),
  item({
    id: "sized",
    name: "Executiva",
    sizes: [
      { id: "p", name: "P", priceCents: 1500 },
      { id: "g", name: "G", priceCents: 2200 },
    ],
  }),
  item({ id: "weekdays", name: "Feijoada", availableWeekdays: [3] }),
];

describe("setQty", () => {
  test("adds, changes, and removes lines", () => {
    let cart = setQty([], "meal", null, 1);
    cart = setQty(cart, "sized", "g", 2);
    cart = setQty(cart, "meal", null, 3);
    expect(cart).toEqual([
      { menuItemId: "meal", sizeId: null, qty: 3 },
      { menuItemId: "sized", sizeId: "g", qty: 2 },
    ]);
    expect(qtyOf(cart, "sized", "p")).toBe(0);
    expect(setQty(cart, "meal", null, 0)).toEqual([{ menuItemId: "sized", sizeId: "g", qty: 2 }]);
  });

  test("clamps to 0..99", () => {
    expect(setQty([], "meal", null, 150)).toEqual([{ menuItemId: "meal", sizeId: null, qty: 99 }]);
    expect(setQty([], "meal", null, -2)).toEqual([]);
  });
});

describe("priceCart and cartTotals", () => {
  test("prices sizes and base prices, and adds the fee for delivery only", () => {
    const cart = setQty(setQty([], "meal", null, 2), "sized", "g", 1);
    const lines = priceCart(cart, menu, 2);
    expect(lines.map((l) => [l.name, l.sizeName, l.lineCents])).toEqual([
      ["Frango", null, 3780],
      ["Executiva", "G", 2200],
    ]);
    expect(cartTotals(lines, "delivery", 500)).toEqual({
      count: 3,
      subtotalCents: 5980,
      deliveryFeeCents: 500,
      totalCents: 6480,
    });
    expect(cartTotals(lines, "pickup", 500).totalCents).toBe(5980);
  });

  test("drops lines the server would refuse", () => {
    const cart = [
      { menuItemId: "gone", sizeId: null, qty: 1 },
      { menuItemId: "sized", sizeId: null, qty: 1 },
      { menuItemId: "meal", sizeId: "g", qty: 1 },
      { menuItemId: "weekdays", sizeId: null, qty: 1 },
    ];
    expect(priceCart(cart, menu, 2)).toEqual([]);
    expect(priceCart(cart, menu, 3).map((l) => l.name)).toEqual(["Feijoada"]);
  });

  test("an empty cart has no fee", () => {
    expect(cartTotals([], "delivery", 500).totalCents).toBe(0);
  });
});

describe("parseCart", () => {
  test("keeps valid lines and drops the rest", () => {
    expect(
      parseCart([
        { menuItemId: "meal", sizeId: null, qty: 2 },
        { menuItemId: "x", sizeId: null, qty: 0 },
        { menuItemId: 1, sizeId: null, qty: 1 },
        "junk",
      ]),
    ).toEqual([{ menuItemId: "meal", sizeId: null, qty: 2 }]);
    expect(parseCart("nope")).toEqual([]);
  });
});
