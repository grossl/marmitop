// covers FR-184, FR-185
import { describe, expect, test } from "bun:test";

import { formatBRL } from "../money";
import type { MenuItemForOrder } from "../order-total";
import { applyCartPatch, emptyCart, missingCartFields, quoteCart } from "./cart";

const menu: MenuItemForOrder[] = [
  {
    id: "frango",
    kind: "meal",
    name: "Marmita de Frango",
    priceCents: 2000,
    available: true,
    availableWeekdays: [0, 1, 2, 3, 4, 5, 6],
    sizes: [
      { id: "g", name: "Grande", priceCents: 2200 },
      { id: "p", name: "Pequena", priceCents: 1800 },
    ],
  },
  {
    id: "coca",
    kind: "drink",
    name: "Coca-Cola Lata",
    priceCents: 600,
    available: true,
    availableWeekdays: [1],
    sizes: [],
  },
];

describe("missingCartFields", () => {
  test("an empty cart misses items and fulfillment", () => {
    expect(missingCartFields(emptyCart())).toEqual(["items", "fulfillment"]);
  });
  test("delivery needs logradouro and bairro, not numero", () => {
    const cart = applyCartPatch(emptyCart(), {
      lines: [{ menuItemId: "frango", sizeId: "g", quantity: 1, notes: null }],
      fulfillment: "delivery",
    });
    expect(missingCartFields(cart)).toEqual(["logradouro", "bairro"]);
    const full = applyCartPatch(cart, { address: { logradouro: "Rua das Flores", bairro: "Centro" } });
    expect(missingCartFields(full)).toEqual([]);
  });
  test("pickup needs no address", () => {
    const cart = applyCartPatch(emptyCart(), {
      lines: [{ menuItemId: "frango", sizeId: "g", quantity: 1, notes: null }],
      fulfillment: "pickup",
    });
    expect(missingCartFields(cart)).toEqual([]);
  });
});

describe("applyCartPatch", () => {
  test("raises the version only when something changes", () => {
    const a = applyCartPatch(emptyCart(), { fulfillment: "pickup" });
    expect(a.version).toBe(2);
    expect(applyCartPatch(a, { fulfillment: "pickup" }).version).toBe(2);
    expect(applyCartPatch(a, {}).version).toBe(2);
  });
  test("null fields in a patch mean no change; lines replace the whole list", () => {
    const a = applyCartPatch(emptyCart(), { lines: [{ menuItemId: "frango", sizeId: "g", quantity: 2, notes: null }] });
    const b = applyCartPatch(a, { lines: null, fulfillment: null, address: null, customerName: null });
    expect(b).toEqual(a);
    const c = applyCartPatch(a, { lines: [{ menuItemId: "coca", sizeId: null, quantity: 1, notes: null }] });
    expect(c.lines.map((l) => l.menuItemId)).toEqual(["coca"]);
  });
  test("address merges field by field and trims; blank text clears", () => {
    const a = applyCartPatch(emptyCart(), { address: { logradouro: " Rua A ", bairro: "Centro" } });
    const b = applyCartPatch(a, { address: { numero: "120", bairro: "  " } });
    expect(b.address).toEqual({ logradouro: "Rua A", numero: "120", bairro: null, complemento: null });
  });
});

describe("quoteCart", () => {
  test("prices come from the menu; the fee applies to delivery only", () => {
    const lines = [{ menuItemId: "frango", sizeId: "g", quantity: 2, notes: null }];
    const delivery = quoteCart({
      cart: applyCartPatch(emptyCart(), { lines, fulfillment: "delivery" }),
      menu,
      deliveryFeeCents: 500,
      weekday: 1,
    });
    expect([delivery.subtotalCents, delivery.deliveryFeeCents, delivery.totalCents]).toEqual([4400, 500, 4900]);
    const pickup = quoteCart({
      cart: applyCartPatch(emptyCart(), { lines, fulfillment: "pickup" }),
      menu,
      deliveryFeeCents: 500,
      weekday: 1,
    });
    expect(pickup.totalCents).toBe(4400);
  });
  test("no fulfillment yet quotes without a fee", () => {
    const cart = applyCartPatch(emptyCart(), {
      lines: [{ menuItemId: "frango", sizeId: "p", quantity: 1, notes: null }],
    });
    expect(quoteCart({ cart, menu, deliveryFeeCents: 500, weekday: 1 }).totalCents).toBe(1800);
  });
  test("an empty cart quotes zero", () => {
    expect(quoteCart({ cart: emptyCart(), menu, deliveryFeeCents: 500, weekday: 1 }).totalCents).toBe(0);
  });
  test("an item off today's weekday is rejected by computeOrderTotal", () => {
    const cart = applyCartPatch(emptyCart(), {
      lines: [{ menuItemId: "coca", sizeId: null, quantity: 1, notes: null }],
    });
    expect(() => quoteCart({ cart, menu, deliveryFeeCents: 0, weekday: 3 })).toThrow();
  });
  test("formatBRL is the money format the tools use", () => {
    expect(formatBRL(4900)).toContain("49,00");
  });
});
