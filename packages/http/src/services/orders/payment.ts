// setOrderPaymentMethod (FR-188, ADR-025): staff set "A definir" to a real method, or change it.

import { AppError } from "@mt/core";
import { type PaymentMethod, setOrderPaymentMethodSchema } from "@mt/schemas";

import { defineService } from "../../service";

export const setOrderPaymentMethod = defineService({
  name: "orders.setPaymentMethod",
  minRole: "attendant",
  input: setOrderPaymentMethodSchema,
  run: async ({ tx, ctx, input }): Promise<{ orderId: string; paymentMethod: PaymentMethod }> => {
    const rows = await tx<{ id: string }[]>`
      update public.orders set payment_method = ${input.paymentMethod}, change_for_cents = null
      where id = ${input.orderId} and restaurant_id = ${ctx.restaurantId}
      returning id
    `;
    if (rows.length === 0) throw new AppError("not_found", "Order not found.");
    return { orderId: input.orderId, paymentMethod: input.paymentMethod };
  },
});
