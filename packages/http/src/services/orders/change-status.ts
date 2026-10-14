// packages/http/src/services/orders/change-status.ts
//
// Status moves and cancel (FR-021, FR-022, FR-023, FR-026, FR-028; ADR-017;
// Appendix A `changeOrderStatus`, `cancelOrder`). The core status machine
// decides; the database trigger is the backstop and writes the history row.

import { AppError, applyTransition, type Fulfillment, type OrderStatus } from "@mt/core";
import type { Tx } from "@mt/db";
import { cancelOrderActionSchema, changeOrderStatusActionSchema } from "@mt/schemas";

import { defineService } from "../../service";

export interface OrderStatusResult {
  readonly id: string;
  readonly code: string;
  readonly status: OrderStatus;
  readonly changed: boolean;
  readonly deliveredAt: string | null;
  readonly cancelledAt: string | null;
}

async function move(
  tx: Tx,
  ctx: { restaurantId: string; actorType: "user" | "api_key" | "system" },
  orderId: string,
  to: OrderStatus,
  reason: string | undefined,
  now: Date,
): Promise<OrderStatusResult> {
  // The row lock serializes two attendants dragging the same card.
  const [order] = await tx<{ id: string; code: string; status: OrderStatus; fulfillment: Fulfillment }[]>`
    select id, code, status, fulfillment from public.orders
    where restaurant_id = ${ctx.restaurantId} and id = ${orderId}
    for update
  `;
  if (order === undefined) throw new AppError("not_found", "Order not found.");

  const result = applyTransition(order, to, { changedBy: null, actorType: ctx.actorType }, now);
  if (result.kind === "rejected") throw result.error;
  if (result.kind === "noop") {
    const [cur] = await tx<{ delivered_at: Date | null; cancelled_at: Date | null }[]>`
      select delivered_at, cancelled_at from public.orders where id = ${orderId}`;
    return {
      id: order.id,
      code: order.code,
      status: order.status,
      changed: false,
      deliveredAt: cur?.delivered_at?.toISOString() ?? null,
      cancelledAt: cur?.cancelled_at?.toISOString() ?? null,
    };
  }

  const cancelReason = to === "cancelado" ? (reason?.trim() ? reason.trim() : null) : null;
  const [updated] = await tx<{ delivered_at: Date | null; cancelled_at: Date | null }[]>`
    update public.orders
    set status = ${to}, cancel_reason = ${cancelReason}
    where restaurant_id = ${ctx.restaurantId} and id = ${orderId}
    returning delivered_at, cancelled_at
  `;
  // RLS hides the row from a role that cannot write; zero rows means the second line refused.
  if (updated === undefined) throw new AppError("forbidden", "Your role cannot perform this action.");
  return {
    id: order.id,
    code: order.code,
    status: to,
    changed: true,
    deliveredAt: updated.delivered_at?.toISOString() ?? null,
    cancelledAt: updated.cancelled_at?.toISOString() ?? null,
  };
}

export const changeOrderStatus = defineService({
  name: "orders.changeStatus",
  minRole: "attendant",
  input: changeOrderStatusActionSchema,
  run: ({ tx, ctx, deps, input }) =>
    move(tx, ctx, input.orderId, input.toStatus, input.reason, deps.clock.now()),
});

export const cancelOrder = defineService({
  name: "orders.cancel",
  minRole: "attendant",
  input: cancelOrderActionSchema,
  run: ({ tx, ctx, deps, input }) => move(tx, ctx, input.orderId, "cancelado", input.reason, deps.clock.now()),
});
