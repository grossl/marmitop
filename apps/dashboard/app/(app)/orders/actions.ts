"use server";

import {
  cancelOrder,
  changeOrderStatus,
  getOrder,
  getOrderKpis,
  listOrders,
} from "@mt/http";
import {
  cancelOrderActionSchema,
  changeOrderStatusActionSchema,
  getOrderActionSchema,
  getOrderKpisSchema,
  listOrdersActionSchema,
} from "@mt/schemas";
import { revalidatePath } from "next/cache";

import { memberAction } from "@/lib/server/safe-action";

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
