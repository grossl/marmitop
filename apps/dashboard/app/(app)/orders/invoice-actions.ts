"use server";

import { cancelInvoice, getInvoiceFiles, getOrderInvoices, issueInvoice, refreshInvoice } from "@mt/http";
import { cancelInvoiceSchema, issueInvoiceSchema, orderInvoiceRefSchema, uuidSchema } from "@mt/schemas";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { adminAction, memberAction } from "@/lib/server/safe-action";

// Invoice Server Actions (06.api-spec.md Appendix A; FR-120..FR-139, ADR-015).
// issue, refresh, files: attendant and admin (`AA`). cancel: admin only (`A`).
// File URLs are short-lived, go straight to the browser, and are never stored (ADR-003).

export const issueInvoiceAction = memberAction(
  { name: "invoices.issue", input: issueInvoiceSchema },
  async ({ deps, ctx, input }) => {
    const result = await issueInvoice(deps, ctx, input);
    if (result.outcome === "queued") revalidatePath("/orders");
    return result;
  },
);

export const listOrderInvoicesAction = memberAction(
  { name: "invoices.listForOrder", input: z.object({ orderId: uuidSchema }) },
  ({ deps, ctx, input }) => getOrderInvoices(deps, ctx, input),
);

export const refreshInvoiceAction = memberAction(
  { name: "invoices.refresh", input: orderInvoiceRefSchema },
  ({ deps, ctx, input }) => refreshInvoice(deps, ctx, input),
);

export const getInvoiceFilesAction = memberAction(
  { name: "invoices.files", input: orderInvoiceRefSchema },
  ({ deps, ctx, input }) => getInvoiceFiles(deps, ctx, input),
);

export const cancelInvoiceAction = adminAction(
  { name: "invoices.cancel", input: cancelInvoiceSchema },
  async ({ deps, ctx, input }) => {
    const result = await cancelInvoice(deps, ctx, input);
    revalidatePath("/orders");
    return result;
  },
);
