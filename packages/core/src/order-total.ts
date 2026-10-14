// computeOrderTotal (ADR-006, FR-037). Pure. The client sends item ids, size ids,
// and quantities. Prices come from the menu rows the service loads.

import { AppError, type ErrorDetail } from "./errors";
import { assertCents } from "./money";
import type { Fulfillment } from "./order-status";

export interface MenuSizeForOrder {
  readonly id: string;
  readonly name: string;
  readonly priceCents: number;
}

export interface MenuItemForOrder {
  readonly id: string;
  readonly kind: "meal" | "drink";
  readonly name: string;
  readonly priceCents: number;
  readonly available: boolean;
  /** 0 = Sunday .. 6 = Saturday. */
  readonly availableWeekdays: readonly number[];
  readonly sizes: readonly MenuSizeForOrder[];
}

export interface OrderLineInput {
  readonly menuItemId: string;
  readonly sizeId?: string | null;
  readonly qty: number;
  readonly notes?: string | null;
}

export interface OrderTotalInput {
  readonly lines: readonly OrderLineInput[];
  readonly menu: readonly MenuItemForOrder[];
  readonly fulfillment: Fulfillment;
  readonly deliveryFeeCents: number;
  /** Weekday of "now" in the restaurant timezone (0 = Sunday). */
  readonly weekday: number;
}

/** Snapshot row for `order_items` (ADR-006). */
export interface OrderItemSnapshot {
  readonly menuItemId: string;
  readonly name: string;
  readonly sizeName: string | null;
  readonly unitPriceCents: number;
  readonly qty: number;
  readonly lineTotalCents: number;
  readonly notes: string | null;
  readonly position: number;
}

export interface OrderTotal {
  readonly items: readonly OrderItemSnapshot[];
  readonly subtotalCents: number;
  readonly deliveryFeeCents: number;
  readonly totalCents: number;
}

const AVAILABILITY_CODES = new Set(["item_unavailable"]);

export function computeOrderTotal(input: OrderTotalInput): OrderTotal {
  const details: ErrorDetail[] = [];
  const items: OrderItemSnapshot[] = [];
  const byId = new Map(input.menu.map((m) => [m.id, m]));

  if (input.lines.length === 0) {
    throw new AppError("validation_failed", "The order has no items.", {
      details: [{ path: "items", code: "too_small", message: "Add at least one item." }],
    });
  }
  assertCents(input.deliveryFeeCents, "deliveryFeeCents");
  if (input.deliveryFeeCents < 0) {
    throw new AppError("validation_failed", "The delivery fee must not be negative.", {
      details: [{ path: "delivery_fee_cents", code: "too_small", message: "Must be zero or more." }],
    });
  }

  input.lines.forEach((line, i) => {
    const at = `items[${i}]`;
    let lineOk = true;
    if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > 99) {
      details.push({
        path: `${at}.qty`,
        code: "invalid_quantity",
        message: "Quantity must be an integer from 1 to 99.",
      });
      lineOk = false;
    }
    const item = byId.get(line.menuItemId);
    if (!item || !item.available) {
      details.push({ path: `${at}.menu_item_id`, code: "item_unavailable", message: "Item is not available." });
      return;
    }
    if (!item.availableWeekdays.includes(input.weekday)) {
      details.push({
        path: `${at}.menu_item_id`,
        code: "item_unavailable",
        message: "Item is not offered on this weekday.",
      });
      return;
    }
    let unitPriceCents = item.priceCents;
    let sizeName: string | null = null;
    if (item.sizes.length > 0) {
      if (!line.sizeId) {
        details.push({ path: `${at}.size_id`, code: "size_required", message: "This item needs a size." });
        return;
      }
      const size = item.sizes.find((s) => s.id === line.sizeId);
      if (!size) {
        details.push({ path: `${at}.size_id`, code: "item_unavailable", message: "Size is not available." });
        return;
      }
      unitPriceCents = size.priceCents;
      sizeName = size.name;
    } else if (line.sizeId) {
      details.push({ path: `${at}.size_id`, code: "size_not_applicable", message: "This item has no sizes." });
      return;
    }
    if (!lineOk) return;
    assertCents(unitPriceCents, "unitPriceCents");
    items.push({
      menuItemId: item.id,
      name: item.name,
      sizeName,
      unitPriceCents,
      qty: line.qty,
      lineTotalCents: unitPriceCents * line.qty,
      notes: line.notes ?? null,
      position: i,
    });
  });

  if (details.length > 0) {
    const unavailable = details.some((d) => AVAILABILITY_CODES.has(d.code));
    throw new AppError(
      unavailable ? "item_unavailable" : "validation_failed",
      unavailable ? "One or more items are not available." : "The order is invalid.",
      { details },
    );
  }

  const subtotalCents = items.reduce((sum, it) => sum + it.lineTotalCents, 0);
  const deliveryFeeCents = input.fulfillment === "delivery" ? input.deliveryFeeCents : 0;
  return { items, subtotalCents, deliveryFeeCents, totalCents: subtotalCents + deliveryFeeCents };
}
