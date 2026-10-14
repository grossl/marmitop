"use server";

import { createCustomer, getCustomer, listCustomers, updateCustomer } from "@mt/http";
import {
  createCustomerActionSchema,
  customerIdActionSchema,
  listCustomersActionSchema,
  updateCustomerActionSchema,
} from "@mt/schemas";

import { memberAction } from "@/lib/server/safe-action";

// Appendix A (06.api-spec.md): listCustomers, getCustomer, createCustomer,
// updateCustomer. No delete (ADR-018).

export const listCustomersAction = memberAction(
  { name: "customers.list", input: listCustomersActionSchema },
  ({ deps, ctx, input }) => listCustomers(deps, ctx, input),
);

export const getCustomerAction = memberAction(
  { name: "customers.get", input: customerIdActionSchema },
  ({ deps, ctx, input }) => getCustomer(deps, ctx, input),
);

export const createCustomerAction = memberAction(
  { name: "customers.create", input: createCustomerActionSchema },
  ({ deps, ctx, input }) => createCustomer(deps, ctx, input),
);

export const updateCustomerAction = memberAction(
  { name: "customers.update", input: updateCustomerActionSchema },
  ({ deps, ctx, input }) => updateCustomer(deps, ctx, input),
);
