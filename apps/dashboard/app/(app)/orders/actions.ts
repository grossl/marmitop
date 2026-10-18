"use server";

import {
  cancelOrder,
  changeOrderStatus,
  getOrder,
  getOrderKpis,
  listOrders,
  markOrderPaid,
  setOrderPaymentMethod,
  unmarkOrderPaid,
} from "@mt/http";
import {
  cancelOrderActionSchema,
  changeOrderStatusActionSchema,
  getOrderActionSchema,
  getOrderKpisSchema,
  listOrdersActionSchema,
  orderPaymentSchema,
  setOrderPaymentMethodSchema,
} from "@mt/schemas";
import { revalidatePath } from "next/cache";

import { adminAction, memberAction } from "@/lib/server/safe-action";

// Orders board Server Actions (06.api-spec.md Appendix A, all `AA`). FR-020..FR-029.

export const listOrdersAction = memberAction(
  { name: "orders.list", input: listOrdersActionSchema },
  ({ deps, ctx, input }) => listOrders(deps, ctx, input),
);

export const getOrderKpisAction = memberAction(
  { name: "orders.kpis", input: getOrderKpisSchema },
  ({ deps, ctx, input }) => getOrderKpis(deps, ctx, input),
);

export const getOrderAction = memberAction(
  { name: "orders.get", input: getOrderActionSchema },
  ({ deps, ctx, input }) => getOrder(deps, ctx, input),
);

export const changeOrderStatusAction = memberAction(
  { name: "orders.changeStatus", input: changeOrderStatusActionSchema },
  async ({ deps, ctx, input }) => {
    const result = await changeOrderStatus(deps, ctx, input);
    revalidatePath("/orders");
    return result;
  },
);

export const cancelOrderAction = memberAction(
  { name: "orders.cancel", input: cancelOrderActionSchema },
  async ({ deps, ctx, input }) => {
    const result = await cancelOrder(deps, ctx, input);
    revalidatePath("/orders");
    return result;
  },
);

// Payment mark (ADR-020; FR-161, FR-162). Marking is `AA`; clearing is `A`.

export const markOrderPaidAction = memberAction(
  { name: "finance.markPaid", input: orderPaymentSchema },
  async ({ deps, ctx, input }) => {
    const result = await markOrderPaid(deps, ctx, input);
    revalidatePath("/orders");
    revalidatePath("/finance");
    return result;
  },
);

export const unmarkOrderPaidAction = adminAction(
  { name: "finance.unmarkPaid", input: orderPaymentSchema },
  async ({ deps, ctx, input }) => {
    const result = await unmarkOrderPaid(deps, ctx, input);
    revalidatePath("/orders");
    revalidatePath("/finance");
    return result;
  },
);

// Payment method for an order that has none, "A definir" (FR-188, ADR-025).

export const setOrderPaymentMethodAction = memberAction(
  { name: "orders.setPaymentMethod", input: setOrderPaymentMethodSchema },
  async ({ deps, ctx, input }) => {
    const result = await setOrderPaymentMethod(deps, ctx, input);
    revalidatePath("/orders");
    revalidatePath("/finance");
    return result;
  },
);
