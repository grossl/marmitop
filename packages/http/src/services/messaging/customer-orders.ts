// A customer's orders, newest first, with a one-line item list. Used by the
// conversation view (FR-018) and the contact sheet (FR-043).

import type { Tx } from "@mt/db";

export interface CustomerOrderSummary {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly fulfillment: string;
  readonly paymentMethod: string;
  readonly totalCents: number;
  readonly createdAt: string;
  readonly items: readonly { readonly name: string; readonly qty: number }[];
}

interface OrderRow {
  id: string;
  code: string;
  status: string;
  fulfillment: string;
  payment_method: string;
  total_cents: number;
  created_at: Date;
}

export async function listCustomerOrders(
  tx: Tx,
  restaurantId: string,
  customerId: string,
  limit = 50,
): Promise<CustomerOrderSummary[]> {
  const orders = await tx<OrderRow[]>`
    select id, code, status, fulfillment, payment_method, total_cents, created_at
    from public.orders
    where restaurant_id = ${restaurantId} and customer_id = ${customerId}
    order by created_at desc, id
    limit ${limit}
  `;
  if (orders.length === 0) return [];
  const ids = orders.map((o) => o.id);
  const items = await tx<{ order_id: string; name: string; qty: number }[]>`
    select order_id, name, qty from public.order_items
    where restaurant_id = ${restaurantId} and order_id in ${tx(ids)}
    order by order_id, position
  `;
  const byOrder = new Map<string, { name: string; qty: number }[]>();
  for (const item of items) {
    const list = byOrder.get(item.order_id) ?? [];
    list.push({ name: item.name, qty: item.qty });
    byOrder.set(item.order_id, list);
  }
  return orders.map((o) => ({
    id: o.id,
    code: o.code,
    status: o.status,
    fulfillment: o.fulfillment,
    paymentMethod: o.payment_method,
    totalCents: o.total_cents,
    createdAt: o.created_at.toISOString(),
    items: byOrder.get(o.id) ?? [],
  }));
}
