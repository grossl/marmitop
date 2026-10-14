// Order requests (06.api-spec.md "Orders", FR-017, FR-021, FR-030..FR-037, FR-142).
// The client sends ids, sizes, and quantities. It never sends prices, totals, status, or source (ADR-006, ADR-017).

import { type ErrorDetail, ORDER_STATUSES } from "@mt/core";
import { z } from "zod";
import {
  addressShapeCamel,
  addressShapeSnake,
  optionalOf,
  paginationQuerySchema,
  searchTermSchema,
  uuidSchema,
} from "./common";

export const PAYMENT_METHODS = ["pix", "dinheiro", "cartao_credito", "cartao_debito"] as const;
export const FULFILLMENTS = ["delivery", "pickup"] as const;
export const ORDER_SOURCES = ["counter", "phone", "whatsapp", "api"] as const;
/** Sources a dashboard user can pick. `api` is set by the server for API-key calls. */
export const DASHBOARD_ORDER_SOURCES = ["counter", "phone", "whatsapp"] as const;

const qtySchema = z.number().int().min(1).max(99);
const itemNotes = optionalOf(z.string().trim().max(280));
const orderNotes = optionalOf(z.string().trim().max(1000));
const changeSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullish();

export const orderItemBodySchema = z
  .object({
    menu_item_id: uuidSchema,
    size_id: uuidSchema.nullish(),
    qty: qtySchema,
    notes: itemNotes,
  })
  .strict();

export const orderItemActionSchema = z
  .object({
    menuItemId: uuidSchema,
    sizeId: uuidSchema.nullish(),
    qty: qtySchema,
    notes: itemNotes,
  })
  .strict();

/** FR-035: change applies to cash only. */
function changeFor<T extends { payment_method?: string; paymentMethod?: string }>(
  v: T,
  change: number | null | undefined,
) {
  return (v.payment_method ?? v.paymentMethod) === "dinheiro" ? (change ?? null) : null;
}

/** `POST /v1/orders`. Address parts left out are copied from the customer by the service. */
export const createOrderBodySchema = z
  .object({
    customer_id: uuidSchema,
    fulfillment: z.enum(FULFILLMENTS),
    ...addressShapeSnake,
    payment_method: z.enum(PAYMENT_METHODS),
    change_for_cents: changeSchema,
    notes: orderNotes,
    items: z.array(orderItemBodySchema).min(1).max(100),
  })
  .strict()
  .transform((v) => ({ ...v, change_for_cents: changeFor(v, v.change_for_cents) }));

/**
 * FR-034: run after the service copies missing address parts from the customer. A delivery order
 * needs `logradouro` and `bairro`. Returns field errors, empty when fine.
 */
export function assertDeliveryAddress(input: {
  readonly fulfillment: "delivery" | "pickup";
  readonly logradouro?: string | null;
  readonly bairro?: string | null;
}): ErrorDetail[] {
  if (input.fulfillment !== "delivery") return [];
  const details: ErrorDetail[] = [];
  if (!input.logradouro?.trim()) details.push({ path: "logradouro", code: "required", message: "Informe a rua." });
  if (!input.bairro?.trim()) details.push({ path: "bairro", code: "required", message: "Informe o bairro." });
  return details;
}

/** `createOrder` Server Action. The form always carries the address, so delivery is checked here. */
export const createOrderActionSchema = z
  .object({
    customerId: uuidSchema,
    items: z.array(orderItemActionSchema).min(1).max(100),
    fulfillment: z.enum(FULFILLMENTS),
    ...addressShapeCamel,
    paymentMethod: z.enum(PAYMENT_METHODS),
    changeForCents: changeSchema,
    notes: orderNotes,
    source: z.enum(DASHBOARD_ORDER_SOURCES),
    conversationId: optionalOf(uuidSchema),
  })
  .superRefine((v, ctx) => {
    for (const d of assertDeliveryAddress(v)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [d.path], message: d.message, params: { code: d.code } });
    }
  })
  .transform((v) => ({ ...v, changeForCents: changeFor(v, v.changeForCents) }));

const reasonSchema = z.string().trim().max(500);

/** `PATCH /v1/orders/{id}`: status only. */
export const patchOrderBodySchema = z
  .object({ status: z.enum(ORDER_STATUSES), reason: reasonSchema.optional() })
  .strict();

export const changeOrderStatusActionSchema = z.object({
  orderId: uuidSchema,
  toStatus: z.enum(ORDER_STATUSES),
  reason: reasonSchema.optional(),
});

export const cancelOrderActionSchema = z.object({ orderId: uuidSchema, reason: reasonSchema.optional() });

const isoTimestamp = z.string().datetime({ offset: true });

/** `GET /v1/orders` and the board search. */
export const listOrdersQuerySchema = z
  .object({
    status: z.enum(ORDER_STATUSES).optional(),
    source: z.enum(ORDER_SOURCES).optional(),
    customer_id: uuidSchema.optional(),
    from: isoTimestamp.optional(),
    to: isoTimestamp.optional(),
    q: searchTermSchema.optional(),
  })
  .merge(paginationQuerySchema);

export const getOrderKpisSchema = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
