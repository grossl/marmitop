// Invoice requests (Appendix A; FR-120, FR-122, FR-129, FR-130).

import { z } from "zod";
import { uuidSchema } from "./common";

export const INVOICE_KINDS = ["nfce", "nfe"] as const;

/** `issueInvoice`. `identifyBuyer` is "CPF na nota" for a pickup order. */
export const issueInvoiceSchema = z.object({
  orderId: uuidSchema,
  kind: z.enum(INVOICE_KINDS).default("nfce"),
  identifyBuyer: z.boolean().default(false),
});

/** `getInvoiceFiles` and `refreshInvoice`. */
export const orderInvoiceRefSchema = z.object({ orderInvoiceId: uuidSchema });

/** `cancelInvoice`: SEFAZ justification of 15 to 255 characters (admin only, checked by the service). */
export const cancelInvoiceSchema = z.object({
  orderInvoiceId: uuidSchema,
  justificativa: z.string().trim().min(15, "A justificativa precisa de pelo menos 15 caracteres.").max(255),
});
