"use server";

import { createOrder, lookupCustomers, quickCreateCustomer } from "@mt/http";
import {
  createOrderActionSchema,
  lookupCustomersActionSchema,
  quickCreateCustomerActionSchema,
} from "@mt/schemas";
import { revalidatePath } from "next/cache";

import { memberAction } from "@/lib/server/safe-action";

// New-order Server Actions (06.api-spec.md Appendix A `createOrder`, `AA`). FR-030..FR-039.

export const createOrderAction = memberAction(
  { name: "orders.create", input: createOrderActionSchema },
  async ({ deps, ctx, input }) => {
    const created = await createOrder(deps, ctx, input);
    revalidatePath("/orders");
    return created;
  },
);

export const lookupCustomersAction = memberAction(
  { name: "orders.lookupCustomers", input: lookupCustomersActionSchema },
  ({ deps, ctx, input }) => lookupCustomers(deps, ctx, input),
);

export const quickCreateCustomerAction = memberAction(
  { name: "orders.quickCreateCustomer", input: quickCreateCustomerActionSchema },
  ({ deps, ctx, input }) => quickCreateCustomer(deps, ctx, input),
);
