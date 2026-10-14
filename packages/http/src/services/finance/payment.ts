// Payment mark (FR-161..FR-163; ADR-020; 06.api-spec.md Appendix A `markOrderPaid`,
// `unmarkOrderPaid`). Attendants and admins mark; only an admin clears. The trigger
// `orders_paid_guard` (migration 0018) refuses a clear from any other role as a backstop.

import { AppError } from "@mt/core";
import type { Tx } from "@mt/db";
import { orderPaymentSchema } from "@mt/schemas";

import type { ServiceContext } from "../../context";
import { defineService } from "../../service";
import { writeAudit } from "../admin/internal";

export interface PaymentMarkResult {
  readonly paidAt: string | null;
  /** False when the order was already in the asked state: no write, no audit row. */
  readonly changed: boolean;
}

async function lockOrder(
  tx: Tx,
  restaurantId: string,
  orderId: string,
): Promise<{ code: string; status: string; paid_at: Date | null }> {
  const [row] = await tx<{ code: string; status: string; paid_at: Date | null }[]>`
    select code, status, paid_at from public.orders
    where restaurant_id = ${restaurantId} and id = ${orderId}
    for update
  `;
  if (row === undefined) throw new AppError("not_found", "Order not found.");
  return row;
}

const userId = (ctx: ServiceContext) => (ctx.actorType === "user" ? ctx.userId : null);

export const markOrderPaid = defineService({
  name: "finance.markPaid",
  minRole: "attendant",
  input: orderPaymentSchema,
  run: async ({ tx, ctx, deps, input }): Promise<PaymentMarkResult> => {
    const order = await lockOrder(tx, ctx.restaurantId, input.orderId);
    if (order.status === "cancelado") {
      throw new AppError("conflict", "A cancelled order cannot be marked paid.", {
        details: [
          { path: "orderId", code: "order_cancelled", message: "Pedido cancelado não pode ser marcado como pago." },
        ],
      });
    }
    if (order.paid_at !== null) return { paidAt: order.paid_at.toISOString(), changed: false };
    const now = deps.clock.now();
    await tx`
      update public.orders set paid_at = ${now}, paid_by = ${userId(ctx)}
      where restaurant_id = ${ctx.restaurantId} and id = ${input.orderId}
    `;
    await writeAudit(tx, ctx, {
      action: "order.mark_paid",
      entityType: "order",
      entityId: input.orderId,
      context: { code: order.code, old_paid_at: null, new_paid_at: now.toISOString() },
    });
    return { paidAt: now.toISOString(), changed: true };
  },
});

export const unmarkOrderPaid = defineService({
  name: "finance.unmarkPaid",
  minRole: "admin",
  input: orderPaymentSchema,
  run: async ({ tx, ctx, input }): Promise<PaymentMarkResult> => {
    const order = await lockOrder(tx, ctx.restaurantId, input.orderId);
    if (order.paid_at === null) return { paidAt: null, changed: false };
    await tx`
      update public.orders set paid_at = null, paid_by = null
      where restaurant_id = ${ctx.restaurantId} and id = ${input.orderId}
    `;
    await writeAudit(tx, ctx, {
      action: "order.unmark_paid",
      entityType: "order",
      entityId: input.orderId,
      context: { code: order.code, old_paid_at: order.paid_at.toISOString(), new_paid_at: null },
    });
    return { paidAt: null, changed: true };
  },
});
