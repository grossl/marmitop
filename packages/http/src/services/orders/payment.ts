// setOrderPaymentMethod (FR-188, ADR-025): staff set "A definir" to a real method, or change it.
// An invoice in progress or authorized carries the method in `pagamentos[]` (08.fiscal-mapping.md),
// so a set method may change only while the order has no active invoice. Every change is audited.

import { AppError } from "@mt/core";
import { type PaymentMethod, setOrderPaymentMethodSchema } from "@mt/schemas";

import { defineService } from "../../service";
import { writeAudit } from "../admin/internal";

/** The statuses of `order_invoices_one_live_per_order` (migration 0008). */
const ACTIVE_INVOICE_STATUSES = ["queued", "received", "processing", "authorized"];

export const setOrderPaymentMethod = defineService({
  name: "orders.setPaymentMethod",
  minRole: "attendant",
  input: setOrderPaymentMethodSchema,
  run: async ({ tx, ctx, input }): Promise<{ orderId: string; paymentMethod: PaymentMethod }> => {
    const [order] = await tx<{ payment_method: PaymentMethod | null; invoice_active: boolean }[]>`
      select o.payment_method,
        exists (select 1 from public.order_invoices i
                where i.restaurant_id = o.restaurant_id and i.order_id = o.id
                  and i.status = any(${ACTIVE_INVOICE_STATUSES})) as invoice_active
      from public.orders o
      where o.id = ${input.orderId} and o.restaurant_id = ${ctx.restaurantId}
      for update of o
    `;
    if (order === undefined) throw new AppError("not_found", "Order not found.");
    if (order.payment_method !== null && order.invoice_active) {
      throw new AppError("conflict", "The order has an active invoice.", {
        details: [
          {
            path: "paymentMethod",
            code: "invoice_active",
            message: "O pedido tem uma nota fiscal em andamento ou emitida. Cancele a nota para trocar o pagamento.",
          },
        ],
      });
    }
    await tx`
      update public.orders set payment_method = ${input.paymentMethod}, change_for_cents = null
      where id = ${input.orderId} and restaurant_id = ${ctx.restaurantId}
    `;
    await writeAudit(tx, ctx, {
      action: "order.payment_method_set",
      entityType: "order",
      entityId: input.orderId,
      context: { from: order.payment_method, to: input.paymentMethod },
    });
    return { orderId: input.orderId, paymentMethod: input.paymentMethod };
  },
});
