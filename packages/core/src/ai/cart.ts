// AI cart rules (12.ai-order-assistant.md "Tools", FR-184, FR-185). Pure. The cart holds ids and
// quantities only; quoteCart prices it from menu rows through computeOrderTotal (ADR-006).

import type { Fulfillment } from "../order-status";
import { computeOrderTotal, type MenuItemForOrder, type OrderTotal } from "../order-total";

export interface CartLine {
  readonly menuItemId: string;
  readonly sizeId: string | null;
  readonly quantity: number;
  readonly notes: string | null;
}

export interface CartAddress {
  readonly logradouro: string | null;
  readonly numero: string | null;
  readonly bairro: string | null;
  readonly complemento: string | null;
}

export interface CartState {
  readonly lines: readonly CartLine[];
  readonly fulfillment: Fulfillment | null;
  readonly address: CartAddress;
  readonly customerName: string | null;
  readonly version: number;
}

export type CartField = "items" | "fulfillment" | "logradouro" | "bairro";

export interface CartPatch {
  readonly lines?: readonly CartLine[] | null;
  readonly fulfillment?: Fulfillment | null;
  readonly address?: Partial<CartAddress> | null;
  readonly customerName?: string | null;
}

const EMPTY_ADDRESS: CartAddress = { logradouro: null, numero: null, bairro: null, complemento: null };

export function emptyCart(): CartState {
  return { lines: [], fulfillment: null, address: EMPTY_ADDRESS, customerName: null, version: 1 };
}

const clean = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

export function applyCartPatch(cart: CartState, patch: CartPatch): CartState {
  const address: CartAddress =
    patch.address == null
      ? cart.address
      : {
          logradouro: "logradouro" in patch.address ? clean(patch.address.logradouro) : cart.address.logradouro,
          numero: "numero" in patch.address ? clean(patch.address.numero) : cart.address.numero,
          bairro: "bairro" in patch.address ? clean(patch.address.bairro) : cart.address.bairro,
          complemento: "complemento" in patch.address ? clean(patch.address.complemento) : cart.address.complemento,
        };
  const next: CartState = {
    lines: patch.lines == null ? cart.lines : patch.lines.map((l) => ({ ...l, notes: clean(l.notes) })),
    fulfillment: patch.fulfillment ?? cart.fulfillment,
    address,
    customerName: patch.customerName == null ? cart.customerName : clean(patch.customerName),
    version: cart.version,
  };
  const changed = JSON.stringify({ ...next, version: 0 }) !== JSON.stringify({ ...cart, version: 0 });
  return changed ? { ...next, version: cart.version + 1 } : cart;
}

export function missingCartFields(cart: CartState): CartField[] {
  const missing: CartField[] = [];
  if (cart.lines.length === 0) missing.push("items");
  if (cart.fulfillment === null) missing.push("fulfillment");
  if (cart.fulfillment === "delivery") {
    if (cart.address.logradouro === null) missing.push("logradouro");
    if (cart.address.bairro === null) missing.push("bairro");
  }
  return missing;
}

export function quoteCart(input: {
  readonly cart: CartState;
  readonly menu: readonly MenuItemForOrder[];
  readonly deliveryFeeCents: number;
  readonly weekday: number;
}): OrderTotal {
  if (input.cart.lines.length === 0) return { items: [], subtotalCents: 0, deliveryFeeCents: 0, totalCents: 0 };
  return computeOrderTotal({
    lines: input.cart.lines.map((l) => ({
      menuItemId: l.menuItemId,
      sizeId: l.sizeId,
      qty: l.quantity,
      notes: l.notes,
    })),
    menu: input.menu,
    fulfillment: input.cart.fulfillment ?? "pickup",
    deliveryFeeCents: input.deliveryFeeCents,
    weekday: input.weekday,
  });
}
