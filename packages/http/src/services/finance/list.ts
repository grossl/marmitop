// Finance list and totals (FR-164..FR-166, FR-169; ADR-020; 06.api-spec.md Appendix A
// `listPaidOrders`, `getFinanceTotals`). Admin only.
//
// An order is paid when `paid_at is not null and status <> 'cancelado'`. The date range is in
// local days of the restaurant timezone and bounds `paid_at` as instants, so the partial index
// `orders_restaurant_paid_idx` serves both reads. The invoice state comes from the newest
// `order_invoices` row (FR-165).

import type { InvoiceStatusValue } from "@mt/core";
import { AppError, localDay } from "@mt/core";
import type { Tx } from "@mt/db";
import { DEFAULT_TIMEZONE, type FinanceInvoiceState, financeFilterSchema, listPaidOrdersSchema } from "@mt/schemas";
import type { z } from "zod";
import type { ServiceContext } from "../../context";
import { defineService } from "../../service";
import type { PaymentMethodCode } from "../orders/shared";

export const FINANCE_PAGE_SIZE = 50;

export const PAYMENT_METHOD_CODES = ["pix", "dinheiro", "cartao_credito", "cartao_debito"] as const;

export interface FinanceRow {
  readonly id: string;
  readonly code: string;
  readonly paidAt: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly paymentMethod: PaymentMethodCode | null;
  readonly totalCents: number;
  readonly status: string;
  readonly fulfillment: "delivery" | "pickup";
  /** The newest invoice of the order, or null when there is none. */
  readonly invoice: { readonly id: string; readonly status: InvoiceStatusValue; readonly numero: number | null } | null;
}

export interface FinancePage {
  readonly rows: readonly FinanceRow[];
  readonly nextCursor: string | null;
  /** The resolved range, inclusive local days. */
  readonly from: string;
  readonly to: string;
  readonly timezone: string;
}

export interface MethodTotal {
  readonly count: number;
  readonly totalCents: number;
}

export interface FinanceTotals {
  readonly count: number;
  readonly totalCents: number;
  readonly byMethod: Readonly<Record<PaymentMethodCode | "a_definir", MethodTotal>>;
  readonly from: string;
  readonly to: string;
  readonly timezone: string;
}

type Filter = z.output<typeof financeFilterSchema>;

interface Range {
  readonly from: string;
  readonly to: string;
  readonly timezone: string;
}

/** Last day of the month of `day` (`YYYY-MM-DD`). */
function monthEnd(day: string): string {
  const [y, m] = day.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${day.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

/** Fills the default range: the current local month (FR-165). A lone `from` or `to` keeps its month. */
async function resolveRange(tx: Tx, ctx: ServiceContext, now: Date, input: Filter): Promise<Range> {
  const [settings] = await tx<{ timezone: string }[]>`
    select timezone from public.restaurant_settings where restaurant_id = ${ctx.restaurantId}
  `;
  const timezone = settings?.timezone ?? DEFAULT_TIMEZONE;
  const today = localDay(now, timezone);
  const from = input.from ?? (input.to ? `${input.to.slice(0, 7)}-01` : `${today.slice(0, 7)}-01`);
  const to = input.to ?? monthEnd(input.from ?? today);
  if (to < from) {
    throw new AppError("validation_failed", "The range ends before it starts.", {
      details: [{ path: "to", code: "invalid", message: "A data final vem antes da inicial." }],
    });
  }
  return { from, to, timezone };
}

const ISSUED: readonly InvoiceStatusValue[] = ["queued", "received", "processing", "authorized"];
const FAILED: readonly InvoiceStatusValue[] = ["failed", "rejected", "denied"];

/** The shared FROM and WHERE of the list and the totals. `inv` is the newest invoice, if any. */
function paidOrdersFrom(tx: Tx, ctx: ServiceContext, range: Range, filter: Filter) {
  const state: FinanceInvoiceState = filter.invoiceState;
  return tx`
    from public.orders o
    join public.customers c on c.restaurant_id = o.restaurant_id and c.id = o.customer_id
    left join lateral (
      select i.id, i.status, i.numero from public.order_invoices i
      where i.restaurant_id = o.restaurant_id and i.order_id = o.id
      order by i.created_at desc, i.id desc limit 1
    ) inv on true
    where o.restaurant_id = ${ctx.restaurantId}
      and o.paid_at is not null
      and o.status <> 'cancelado'
      and o.paid_at >= (${range.from}::date)::timestamp at time zone ${range.timezone}
      and o.paid_at < (${range.to}::date + 1)::timestamp at time zone ${range.timezone}
      ${filter.customerId ? tx`and o.customer_id = ${filter.customerId}` : tx``}
      ${state === "none" ? tx`and (inv.id is null or inv.status = 'cancelled')` : tx``}
      ${state === "issued" ? tx`and inv.status in ${tx(ISSUED)}` : tx``}
      ${state === "failed" ? tx`and inv.status in ${tx(FAILED)}` : tx``}
  `;
}

// The cursor carries paid_at as Postgres text, so microseconds survive the round trip
// (a JS Date keeps milliseconds only, which would repeat or skip rows).
interface Cursor {
  readonly p: string;
  readonly i: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeCursor(raw: string | undefined): Cursor | null {
  if (raw === undefined || raw === "") return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<Cursor>;
    if (typeof v.p === "string" && typeof v.i === "string" && UUID.test(v.i) && !Number.isNaN(Date.parse(v.p))) {
      return { p: v.p, i: v.i };
    }
  } catch {
    // fall through
  }
  throw new AppError("validation_failed", "The cursor is invalid.", {
    details: [{ path: "cursor", code: "invalid", message: "Cursor inválido." }],
  });
}

interface ListRow {
  id: string;
  code: string;
  paid_at: Date;
  paid_at_text: string;
  customer_id: string;
  customer_name: string;
  payment_method: PaymentMethodCode | null;
  total_cents: number;
  status: string;
  fulfillment: "delivery" | "pickup";
  invoice_id: string | null;
  invoice_status: InvoiceStatusValue | null;
  invoice_numero: number | null;
}

export const listPaidOrders = defineService({
  name: "finance.list",
  minRole: "admin",
  input: listPaidOrdersSchema,
  run: async ({ tx, ctx, deps, input }): Promise<FinancePage> => {
    const range = await resolveRange(tx, ctx, deps.clock.now(), input);
    const after = decodeCursor(input.cursor);
    const rows = await tx<ListRow[]>`
      select o.id, o.code, o.paid_at, o.paid_at::text as paid_at_text, o.customer_id, c.name as customer_name,
             o.payment_method, o.total_cents, o.status, o.fulfillment,
             inv.id as invoice_id, inv.status as invoice_status, inv.numero as invoice_numero
      ${paidOrdersFrom(tx, ctx, range, input)}
      ${after ? tx`and (o.paid_at, o.id) < (${after.p}::timestamptz, ${after.i}::uuid)` : tx``}
      order by o.paid_at desc, o.id desc
      limit ${FINANCE_PAGE_SIZE + 1}
    `;
    const page = rows.slice(0, FINANCE_PAGE_SIZE);
    const last = page[page.length - 1];
    return {
      rows: page.map((r) => ({
        id: r.id,
        code: r.code,
        paidAt: r.paid_at.toISOString(),
        customerId: r.customer_id,
        customerName: r.customer_name,
        paymentMethod: r.payment_method,
        totalCents: r.total_cents,
        status: r.status,
        fulfillment: r.fulfillment,
        invoice:
          r.invoice_id && r.invoice_status
            ? { id: r.invoice_id, status: r.invoice_status, numero: r.invoice_numero }
            : null,
      })),
      nextCursor: rows.length > FINANCE_PAGE_SIZE && last ? encodeCursor({ p: last.paid_at_text, i: last.id }) : null,
      ...range,
    };
  },
});

export const getFinanceTotals = defineService({
  name: "finance.totals",
  minRole: "admin",
  input: financeFilterSchema,
  run: async ({ tx, ctx, deps, input }): Promise<FinanceTotals> => {
    const range = await resolveRange(tx, ctx, deps.clock.now(), input);
    const rows = await tx<{ payment_method: PaymentMethodCode | null; n: number; total: number }[]>`
      select o.payment_method, count(*)::int as n, coalesce(sum(o.total_cents), 0)::bigint as total
      ${paidOrdersFrom(tx, ctx, range, input)}
      group by o.payment_method
    `;
    const byMethod = Object.fromEntries(
      [...PAYMENT_METHOD_CODES, "a_definir"].map((m) => [m, { count: 0, totalCents: 0 }]),
    ) as Record<PaymentMethodCode | "a_definir", MethodTotal>;
    let count = 0;
    let totalCents = 0;
    for (const r of rows) {
      byMethod[r.payment_method ?? "a_definir"] = { count: r.n, totalCents: Number(r.total) };
      count += r.n;
      totalCents += Number(r.total);
    }
    return { count, totalCents, byMethod, ...range };
  },
});
