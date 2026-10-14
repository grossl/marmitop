// Menu requests (06.api-spec.md "Menu", Appendix A `saveMenuItem`; FR-050..FR-059).

import { z } from "zod";
import { centsSchema, optionalOf, paginationQuerySchema, uuidSchema } from "./common";

export const MEAL_CATEGORIES = ["proteinas", "vegetariano", "fit", "executiva", "especial"] as const;
export const DRINK_CATEGORIES = ["refrigerantes", "sucos", "agua", "alcoolicas", "quentes"] as const;
export const MENU_KINDS = ["meal", "drink"] as const;

const weekdaysSchema = z
  .array(z.number().int().min(0).max(6))
  .max(7)
  .refine((a) => new Set(a).size === a.length, "Dias repetidos.")
  .transform((a) => [...a].sort((x, y) => x - y))
  .default([0, 1, 2, 3, 4, 5, 6]);

const sizeSchema = z.object({
  id: uuidSchema.optional(),
  name: z.string().trim().min(1, "Informe o nome do tamanho.").max(40),
  priceCents: centsSchema,
});

const httpUrl = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "Use uma URL http ou https.");

export const saveMenuItemSchema = z
  .object({
    id: uuidSchema.optional(),
    kind: z.enum(MENU_KINDS),
    name: z.string().trim().min(1, "Informe o nome.").max(120),
    description: optionalOf(z.string().trim().max(500)),
    category: z.string().trim().min(1),
    priceCents: centsSchema,
    calories: z.number().int().min(0).nullish(),
    volume: optionalOf(z.string().trim().max(20)),
    available: z.boolean().default(true),
    popular: z.boolean().default(false),
    availableWeekdays: weekdaysSchema,
    imageUrl: optionalOf(httpUrl),
    ncm: optionalOf(
      z
        .string()
        .trim()
        .regex(/^\d{8}$/, "NCM deve ter 8 dígitos."),
    ),
    cfop: optionalOf(
      z
        .string()
        .trim()
        .regex(/^\d{4}$/, "CFOP deve ter 4 dígitos."),
    ),
    sizes: z.array(sizeSchema).max(10).default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    const allowed: readonly string[] = v.kind === "meal" ? MEAL_CATEGORIES : DRINK_CATEGORIES;
    if (!allowed.includes(v.category)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["category"],
        message: "Categoria inválida para este tipo de item.",
      });
    }
    if (v.kind === "drink" && v.calories != null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["calories"], message: "Calorias só valem para marmitas." });
    }
    if (v.kind === "meal" && v.volume != null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["volume"], message: "Volume só vale para bebidas." });
    }
    const seen = new Set<string>();
    v.sizes.forEach((s, i) => {
      const key = s.name.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sizes", i, "name"], message: "Tamanho repetido." });
      }
      seen.add(key);
    });
  });

export const setMenuItemAvailabilitySchema = z.object({ id: uuidSchema, available: z.boolean() });
export const deleteMenuItemSchema = z.object({ id: uuidSchema });

const queryBoolean = z.union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")]);

/** `GET /v1/menu`. */
export const listMenuQuerySchema = z
  .object({
    kind: z.enum(MENU_KINDS).optional(),
    available: queryBoolean.optional(),
    weekday: z.coerce.number().int().min(0).max(6).optional(),
    q: z.string().trim().max(100).optional(),
  })
  .merge(paginationQuerySchema);

/** `listMenu` Server Action (Appendix A): the dashboard reads the whole menu, so no paging. */
export const listMenuItemsSchema = z.object({
  kind: z.enum(MENU_KINDS).optional(),
  q: z.string().trim().max(100).optional(),
});
