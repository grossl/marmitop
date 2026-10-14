// Finance requests (06.api-spec.md Appendix A `listPaidOrders`, `getFinanceTotals`,
// `markOrderPaid`, `unmarkOrderPaid`, `issueInvoicesBatch`; FR-160..FR-169, ADR-020).

import { z } from "zod";

import { uuidSchema } from "./common";
import { INVOICE_KINDS } from "./invoices";
import { localDaySchema, parseLocalDay } from "./reports";

/** Invoice state of an order, from its newest invoice row (FR-165). */
export const FINANCE_INVOICE_STATES = ["all", "none", "issued", "failed"] as const;
export type FinanceInvoiceState = (typeof FINANCE_INVOICE_STATES)[number];

/** At most this many orders in one batch issue (FR-168). */
export const FINANCE_BATCH_MAX = 50;

const filterShape = {
  /** Inclusive local days in the restaurant timezone; default: the current month. */
  from: localDaySchema.optional(),
  to: localDaySchema.optional(),
  customerId: uuidSchema.optional(),
  invoiceState: z.enum(FINANCE_INVOICE_STATES).default("all"),
};

function checkRange(v: { from?: string; to?: string }, ctx: z.RefinementCtx): void {
  if (v.from === undefined || v.to === undefined) return;
  const from = parseLocalDay(v.from);
  const to = parseLocalDay(v.to);
  if (from === null || to === null) return;
  if (to < from) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "A data final vem antes da inicial." });
  } else if ((to - from) / 86_400_000 > 365) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "O período máximo é de 366 dias." });
  }
}

/** `getFinanceTotals`. */
export const financeFilterSchema = z.object(filterShape).superRefine(checkRange);

/** `listPaidOrders`: the filter plus an opaque cursor from the previous page. */
export const listPaidOrdersSchema = z
  .object({ ...filterShape, cursor: z.string().max(200).optional() })
  .superRefine(checkRange);

/** `markOrderPaid` and `unmarkOrderPaid`. */
export const orderPaymentSchema = z.object({ orderId: uuidSchema });

/** `issueInvoicesBatch`: duplicate ids collapse, the first position wins. */
export const issueInvoicesBatchSchema = z.object({
  orderIds: z
    .array(uuidSchema)
    .min(1, "Selecione ao menos um pedido.")
    .max(FINANCE_BATCH_MAX, `Selecione no máximo ${FINANCE_BATCH_MAX} pedidos.`)
    .transform((ids) => [...new Set(ids)]),
  kind: z.enum(INVOICE_KINDS).default("nfce"),
});
