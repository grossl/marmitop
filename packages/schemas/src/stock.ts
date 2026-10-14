// Stock requests (Appendix A, FR-060..FR-069).

import { z } from "zod";
import { centsSchema, quantitySchema, uuidSchema } from "./common";

export const STOCK_CATEGORIES = ["insumos", "embalagens", "bebidas"] as const;
export const STOCK_MOVEMENT_KINDS = ["in", "out", "adjust"] as const;

const nonNegativeQty = quantitySchema.refine((v) => v >= 0, "Não pode ser negativo.");

/**
 * `saveStockItem`. The quantity is never edited here (FR-067): `currentQty` is an unknown key and
 * fails. `initialQty` exists on creation only and becomes an `in` movement (FR-061).
 */
export const saveStockItemSchema = z
  .object({
    id: uuidSchema.optional(),
    name: z.string().trim().min(1, "Informe o nome.").max(120),
    unit: z.string().trim().min(1, "Informe a unidade.").max(20),
    category: z.enum(STOCK_CATEGORIES),
    minimumQty: nonNegativeQty,
    unitCostCents: centsSchema,
    initialQty: nonNegativeQty.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.id && v.initialQty !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["initialQty"],
        message: "A quantidade só muda por movimentação.",
      });
    }
  });

/** `recordStockMovement`. `in` and `out` take a positive quantity; `adjust` takes a signed delta. */
export const recordStockMovementSchema = z
  .object({
    stockItemId: uuidSchema,
    kind: z.enum(STOCK_MOVEMENT_KINDS),
    qty: quantitySchema,
    reason: z.string().trim().max(200).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === "adjust" ? v.qty === 0 : v.qty <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["qty"],
        message: v.kind === "adjust" ? "O ajuste não pode ser zero." : "A quantidade deve ser maior que zero.",
      });
    }
  });

export const listStockQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.enum(STOCK_CATEGORIES).optional(),
});
