// Pure cart logic for the public menu checkout (ADR-031, FR-230). The totals here are a
// preview: the server recomputes them from the database (ADR-006).

import type { PublicMenuItemDto } from "@mt/http";

export interface CartLine {
  readonly menuItemId: string;
  readonly sizeId: string | null;
  readonly qty: number;
}

export type Cart = readonly CartLine[];

export const MAX_QTY = 99;

const same = (l: CartLine, menuItemId: string, sizeId: string | null) =>
  l.menuItemId === menuItemId && l.sizeId === sizeId;

export function qtyOf(cart: Cart, menuItemId: string, sizeId: string | null): number {
  return cart.find((l) => same(l, menuItemId, sizeId))?.qty ?? 0;
}

/** Sets one line's quantity, clamped to 0..99. Zero removes the line. New lines go last. */
export function setQty(cart: Cart, menuItemId: string, sizeId: string | null, qty: number): Cart {
  const clamped = Math.max(0, Math.min(MAX_QTY, Math.floor(qty)));
  const exists = cart.some((l) => same(l, menuItemId, sizeId));
  if (clamped === 0) return cart.filter((l) => !same(l, menuItemId, sizeId));
  if (!exists) return [...cart, { menuItemId, sizeId, qty: clamped }];
  return cart.map((l) => (same(l, menuItemId, sizeId) ? { ...l, qty: clamped } : l));
}

export interface PricedLine extends CartLine {
  readonly name: string;
  readonly sizeName: string | null;
  readonly unitPriceCents: number;
  readonly lineCents: number;
}

/**
 * Lines with names and prices from the menu. A line whose item or size left the menu, or
 * that is not offered on `weekday`, is dropped: the server would refuse it.
 */
export function priceCart(cart: Cart, items: readonly PublicMenuItemDto[], weekday: number): PricedLine[] {
  const out: PricedLine[] = [];
  for (const line of cart) {
    const item = items.find((i) => i.id === line.menuItemId);
    if (item === undefined || !item.availableWeekdays.includes(weekday)) continue;
    if (item.sizes.length > 0) {
      const size = item.sizes.find((s) => s.id === line.sizeId);
      if (size === undefined) continue;
      out.push({
        ...line,
        name: item.name,
        sizeName: size.name,
        unitPriceCents: size.priceCents,
        lineCents: size.priceCents * line.qty,
      });
    } else {
      if (line.sizeId !== null) continue;
      out.push({
        ...line,
        name: item.name,
        sizeName: null,
        unitPriceCents: item.priceCents,
        lineCents: item.priceCents * line.qty,
      });
    }
  }
  return out;
}

export interface CartTotals {
  readonly count: number;
  readonly subtotalCents: number;
  readonly deliveryFeeCents: number;
  readonly totalCents: number;
}

export function cartTotals(
  lines: readonly PricedLine[],
  fulfillment: "delivery" | "pickup",
  deliveryFeeCents: number,
): CartTotals {
  const subtotalCents = lines.reduce((sum, l) => sum + l.lineCents, 0);
  const count = lines.reduce((sum, l) => sum + l.qty, 0);
  const fee = fulfillment === "delivery" && count > 0 ? deliveryFeeCents : 0;
  return { count, subtotalCents, deliveryFeeCents: fee, totalCents: subtotalCents + fee };
}

/** Reads a saved cart; anything malformed becomes an empty cart. */
export function parseCart(raw: unknown): Cart {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((l): CartLine[] => {
    if (typeof l !== "object" || l === null) return [];
    const { menuItemId, sizeId, qty } = l as Record<string, unknown>;
    if (typeof menuItemId !== "string" || (sizeId !== null && typeof sizeId !== "string")) return [];
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return [];
    return [{ menuItemId, sizeId: sizeId as string | null, qty }];
  });
}
