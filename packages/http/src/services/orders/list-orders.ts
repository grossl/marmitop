// packages/http/src/services/orders/list-orders.ts
//
// Board data, order detail, and daily KPIs (FR-020, FR-023..FR-025;
// 06.api-spec.md Appendix A `listOrders`, `getOrder`, `getOrderKpis`).

import { AppError, localDay, type OrderStatus } from "@mt/core";
import type { Tx } from "@mt/db";
import { getOrderActionSchema, getOrderKpisSchema, listOrdersActionSchema } from "@mt/schemas";

import { z } from "zod";

import { defineService } from "../../service";
import { listOrderInvoices } from "../invoices/shared";
import { loadOrderSettings } from "./order-settings";
import {
  type BoardOrder,
  likePattern,
  type OrderDetail,
  type OrderRowForView,
  orderViewColumns,
  type StatusHistoryView,
  toBoardOrder,
} from "./shared";

const BOARD_LIMIT = 500;

/**
 * The board for one restaurant-local day (default: today). It holds every order created that day
 * plus every order still open from earlier days, so nothing in progress drops off at midnight.
 * `q` matches the code, the customer name, or an item name (FR-024).
 */
async function queryBoard(
  tx: Tx,
  restaurantId: string,
  timezone: string,
  day: string,
  q: string | undefined,
  status: OrderStatus | undefined,
): Promise<BoardOrder[]> {
  const term = q?.trim();
  const pattern = term ? likePattern(term) : null;
  const rows = await tx<OrderRowForView[]>`
    select ${orderViewColumns(tx)}
    from public.orders o
    join public.customers c on c.restaurant_id = o.restaurant_id and c.id = o.customer_id
    where o.restaurant_id = ${restaurantId}
      and (
        (o.created_at at time zone ${timezone})::date = ${day}::date
        or o.status not in ('finalizado', 'cancelado')
      )
      ${status ? tx`and o.status = ${status}` : tx``}
      ${
        pattern
          ? tx`and (
              o.code ilike ${pattern}
              or c.name ilike ${pattern}
              or exists (
                select 1 from public.order_items qi
                where qi.restaurant_id = o.restaurant_id and qi.order_id = o.id and qi.name ilike ${pattern}
              )
            )`
          : tx``
      }
    order by o.created_at desc
    limit ${BOARD_LIMIT}
  `;
  return rows.map(toBoardOrder);
}

/**
 * The board for one restaurant-local day (default: today). It holds every order created that day
 * plus every order still open from earlier days, so nothing in progress drops off at midnight.
 * `q` matches the code, the customer name, or an item name (FR-024).
 */
export const listOrders = defineService({
  name: "orders.list",
  minRole: "attendant",
  input: listOrdersActionSchema,
  run: async ({ tx, ctx, deps, input }) => {
    const settings = await loadOrderSettings(tx, ctx.restaurantId);
    const day = input.day ?? localDay(deps.clock.now(), settings.timezone);
    return queryBoard(tx, ctx.restaurantId, settings.timezone, day, input.q, input.status);
  },
});

export interface OrderKpis {
  readonly day: string;
  /** `finalizado` orders whose `delivered_at` falls on `day` (ADR-015). */
  readonly deliveredRevenueCents: number;
  readonly deliveredCount: number;
  /** `aguardando`, `confirmado` right now, any creation day (ADR-028). */
  readonly inProgressCount: number;
  readonly readyCount: number;
  readonly outForDeliveryCount: number;
}

async function queryKpis(tx: Tx, restaurantId: string, timezone: string, day: string): Promise<OrderKpis> {
  const [row] = await tx<{ revenue: number; delivered: number; in_progress: number; ready: number; out: number }[]>`
    select
      coalesce(sum(total_cents) filter (
        where status = 'finalizado' and (delivered_at at time zone ${timezone})::date = ${day}::date), 0)::bigint as revenue,
      count(*) filter (
        where status = 'finalizado' and (delivered_at at time zone ${timezone})::date = ${day}::date)::int as delivered,
      count(*) filter (where status in ('aguardando', 'confirmado'))::int as in_progress,
      count(*) filter (where status = 'pronto')::int as ready,
      count(*) filter (where status = 'saiu')::int as out
    from public.orders
    where restaurant_id = ${restaurantId}
  `;
  return {
    day,
    deliveredRevenueCents: Number(row?.revenue ?? 0),
    deliveredCount: row?.delivered ?? 0,
    inProgressCount: row?.in_progress ?? 0,
    readyCount: row?.ready ?? 0,
    outForDeliveryCount: row?.out ?? 0,
  };
}

export const getOrderKpis = defineService({
  name: "orders.kpis",
  minRole: "attendant",
  input: getOrderKpisSchema,
  run: async ({ tx, ctx, input }): Promise<OrderKpis> => {
    const settings = await loadOrderSettings(tx, ctx.restaurantId);
    return queryKpis(tx, ctx.restaurantId, settings.timezone, input.day);
  },
});

export interface OrdersBoard {
  readonly day: string;
  readonly timezone: string;
  readonly orders: readonly BoardOrder[];
  readonly kpis: OrderKpis;
}

/** The board screen's first load: today's orders and KPIs in one transaction (FR-020, FR-025). */
export const getOrdersBoard = defineService({
  name: "orders.board",
  minRole: "attendant",
  input: z.undefined(),
  run: async ({ tx, ctx, deps }): Promise<OrdersBoard> => {
    const settings = await loadOrderSettings(tx, ctx.restaurantId);
    const day = localDay(deps.clock.now(), settings.timezone);
    const [orders, kpis] = [
      await queryBoard(tx, ctx.restaurantId, settings.timezone, day, undefined, undefined),
      await queryKpis(tx, ctx.restaurantId, settings.timezone, day),
    ];
    return { day, timezone: settings.timezone, orders, kpis };
  },
});

/** One order with its items, status history, and invoices (FR-023, FR-128). */
export const getOrder = defineService({
  name: "orders.get",
  minRole: "attendant",
  input: getOrderActionSchema,
  run: async ({ tx, ctx, input }): Promise<OrderDetail> => {
    const [row] = await tx<OrderRowForView[]>`
      select ${orderViewColumns(tx)}
      from public.orders o
      join public.customers c on c.restaurant_id = o.restaurant_id and c.id = o.customer_id
      where o.restaurant_id = ${ctx.restaurantId} and o.id = ${input.orderId}
    `;
    if (row === undefined) throw new AppError("not_found", "Order not found.");
    const history = await tx<
      {
        from_status: StatusHistoryView["fromStatus"];
        to_status: StatusHistoryView["toStatus"];
        actor_type: StatusHistoryView["actorType"];
        changed_at: Date;
      }[]
    >`
      select from_status, to_status, actor_type, changed_at
      from public.order_status_history
      where restaurant_id = ${ctx.restaurantId} and order_id = ${input.orderId}
      order by changed_at, id
    `;
    const [extra] = await tx<{ codigo_municipio: string | null; cpf_cnpj: string | null }[]>`
      select o.codigo_municipio, c.cpf_cnpj
      from public.orders o
      join public.customers c on c.restaurant_id = o.restaurant_id and c.id = o.customer_id
      where o.restaurant_id = ${ctx.restaurantId} and o.id = ${input.orderId}
    `;
    const invoices = await listOrderInvoices(tx, ctx.restaurantId, input.orderId);
    return {
      ...toBoardOrder(row),
      codigoMunicipio: extra?.codigo_municipio ?? null,
      customerCpfCnpj: extra?.cpf_cnpj ?? null,
      invoices,
      cep: row.cep,
      logradouro: row.logradouro,
      numero: row.numero,
      complemento: row.complemento,
      bairro: row.bairro,
      cidade: row.cidade,
      uf: row.uf,
      history: history.map((h) => ({
        fromStatus: h.from_status,
        toStatus: h.to_status,
        actorType: h.actor_type,
        changedAt: h.changed_at.toISOString(),
      })),
    };
  },
});
