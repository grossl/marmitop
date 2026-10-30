// packages/http/src/services/printing/enqueue.ts
//
// The order ticket job (FR-250, ADR-038). Written in the transaction that accepts
// the order: a create with a status other than `aguardando`, or the move out of
// `aguardando` to a status other than `cancelado`. One job per order (unique key).

import type { OrderStatus } from "@mt/core";
import type { Tx } from "@mt/db";

/** True when the move accepts the order, so the kitchen needs its ticket. */
export function acceptsOrder(from: OrderStatus | null, to: OrderStatus): boolean {
  if (to === "aguardando" || to === "cancelado") return false;
  return from === null || from === "aguardando";
}

/** Writes the `order_ticket` job when `auto_print_orders` is on. A second call is a no-op. */
export async function enqueueOrderTicket(tx: Tx, restaurantId: string, orderId: string): Promise<void> {
  await tx`
    insert into public.print_jobs (restaurant_id, order_id, kind)
    select ${restaurantId}, ${orderId}, 'order_ticket'
    from public.restaurant_settings s
    where s.restaurant_id = ${restaurantId} and s.auto_print_orders
    on conflict (restaurant_id, order_id, kind) do nothing
  `;
}
