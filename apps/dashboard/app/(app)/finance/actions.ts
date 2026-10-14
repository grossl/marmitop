"use server";

import { getFinanceTotals, issueInvoicesBatch, listPaidOrders } from "@mt/http";
import { financeFilterSchema, issueInvoicesBatchSchema, listPaidOrdersSchema } from "@mt/schemas";
import { revalidatePath } from "next/cache";

import { adminAction } from "@/lib/server/safe-action";

// Finance Server Actions (06.api-spec.md Appendix A; ADR-020; FR-164..FR-169). All admin only.
// The page reads the first page and the totals in the Server Component; these actions serve
// "Carregar mais" and the batch issue. The payment mark lives in ../orders/actions.ts.

export const listPaidOrdersAction = adminAction(
  { name: "finance.list", input: listPaidOrdersSchema },
  ({ deps, ctx, input }) => listPaidOrders(deps, ctx, input),
);

export const getFinanceTotalsAction = adminAction(
  { name: "finance.totals", input: financeFilterSchema },
  ({ deps, ctx, input }) => getFinanceTotals(deps, ctx, input),
);

export const issueInvoicesBatchAction = adminAction(
  { name: "finance.issueBatch", input: issueInvoicesBatchSchema },
  async ({ deps, ctx, input }) => {
    const result = await issueInvoicesBatch(deps, ctx, input);
    revalidatePath("/finance");
    revalidatePath("/orders");
    return result;
  },
);
