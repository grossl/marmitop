// Public API orders (06.api-spec.md "Orders"; FR-142, FR-020..FR-039; ADR-006, ADR-017).
// Reads are keyset-paged snake_case views. Writes run the dashboard's own code paths
// (`createOrderInTx`, `changeOrderStatusInTx`), so totals, the status machine, the
// history row, the automatic message, usage, and webhook events stay identical.

import { AppError } from "@mt/core";
import type { Tx } from "@mt/db";
import { createOrderBodySchema, listOrdersQuerySchema, patchOrderBodySchema } from "@mt/schemas";
import { z } from "zod";

import { defineService } from "../../service";
import { changeOrderStatusInTx } from "../orders/change-status";
import { createOrderInTx } from "../orders/create-order";
import { likePattern } from "../orders/shared";
import { decodeKeysetCursor, type Page, pageOf } from "./cursor";
import {
  type ApiOrder,
  type ApiOrderDetail,
  type ApiOrderRow,
  apiOrderColumns,
  loadApiOrder,
  loadApiStatusHistory,
  toApiOrder,
} from "./views";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^ORD-\d{3,}$/;

const orderNotFound = () => new AppError("not_found", "Order not found.");

/** `{id}` is the uuid or the code (06.api-spec.md). Anything else, or another restaurant's id, is 404. */
async function resolveOrderId(tx: Tx, restaurantId: string, idOrCode: string): Promise<string> {
  if (!UUID.test(idOrCode) && !CODE.test(idOrCode)) throw orderNotFound();
  const [row] = UUID.test(idOrCode)
    ? await tx<
        { id: string }[]
      >`select id from public.orders where restaurant_id = ${restaurantId} and id = ${idOrCode}`
    : await tx<
        { id: string }[]
      >`select id from public.orders where restaurant_id = ${restaurantId} and code = ${idOrCode}`;
  if (row === undefined) throw orderNotFound();
  return row.id;
}

export const apiListOrders = defineService({
  name: "api.orders.list",
  minRole: "attendant",
  input: listOrdersQuerySchema,
  run: async ({ tx, ctx, input }): Promise<Page<ApiOrder>> => {
    const after = decodeKeysetCursor(input.cursor);
    const pattern = input.q ? likePattern(input.q) : null;
    const rows = await tx<ApiOrderRow[]>`
      select ${apiOrderColumns(tx)}
      from public.orders o
      join public.customers c on c.restaurant_id = o.restaurant_id and c.id = o.customer_id
      where o.restaurant_id = ${ctx.restaurantId}
        ${input.status ? tx`and o.status = ${input.status}` : tx``}
        ${input.source ? tx`and o.source = ${input.source}` : tx``}
        ${input.customer_id ? tx`and o.customer_id = ${input.customer_id}` : tx``}
        ${input.from ? tx`and o.created_at >= ${input.from}::timestamptz` : tx``}
        ${input.to ? tx`and o.created_at < ${input.to}::timestamptz` : tx``}
        ${pattern ? tx`and (o.code ilike ${pattern} or c.name ilike ${pattern})` : tx``}
        ${after ? tx`and (o.created_at, o.id) < (${after.createdAt}::timestamptz, ${after.id}::uuid)` : tx``}
      order by o.created_at desc, o.id desc
      limit ${input.limit + 1}
    `;
    return pageOf(rows, input.limit, toApiOrder);
  },
});

export const apiGetOrder = defineService({
  name: "api.orders.get",
  minRole: "attendant",
  input: z.object({ id: z.string().max(64) }),
  run: async ({ tx, ctx, input }): Promise<ApiOrderDetail> => {
    const id = await resolveOrderId(tx, ctx.restaurantId, input.id);
    const order = await loadApiOrder(tx, ctx.restaurantId, id);
    if (order === null) throw orderNotFound();
    return { ...order, status_history: await loadApiStatusHistory(tx, ctx.restaurantId, id) };
  },
});

/** `POST /v1/orders`. `source` is always `api`; the body cannot carry it (ADR-017). */
export const apiCreateOrder = defineService({
  name: "api.orders.create",
  minRole: "attendant",
  input: createOrderBodySchema,
  run: async ({ tx, ctx, deps, input }): Promise<ApiOrder> => {
    const created = await createOrderInTx(tx, deps, ctx, {
      customerId: input.customer_id,
      items: input.items.map((i) => ({
        menuItemId: i.menu_item_id,
        sizeId: i.size_id ?? null,
        qty: i.qty,
        notes: i.notes,
      })),
      fulfillment: input.fulfillment,
      cep: input.cep,
      logradouro: input.logradouro,
      numero: input.numero,
      complemento: input.complemento,
      bairro: input.bairro,
      cidade: input.cidade,
      uf: input.uf,
      codigoMunicipio: input.codigo_municipio,
      paymentMethod: input.payment_method,
      changeForCents: input.change_for_cents,
      notes: input.notes,
      source: "api",
      conversationId: null,
    });
    const order = await loadApiOrder(tx, ctx.restaurantId, created.id);
    if (order === null) throw new Error("created order not readable");
    return order;
  },
});

/** `PATCH /v1/orders/{id}`: status only (FR-022, ADR-017). */
export const apiChangeOrderStatus = defineService({
  name: "api.orders.changeStatus",
  minRole: "attendant",
  input: patchOrderBodySchema.extend({ id: z.string().max(64) }),
  run: async ({ tx, ctx, deps, input }): Promise<ApiOrder> => {
    const id = await resolveOrderId(tx, ctx.restaurantId, input.id);
    await changeOrderStatusInTx(tx, ctx, id, input.status, input.reason, deps.clock.now());
    const order = await loadApiOrder(tx, ctx.restaurantId, id);
    if (order === null) throw orderNotFound();
    return order;
  },
});
