// packages/http/src/services/admin/reports.ts
//
// Reports (FR-070..FR-079, ADR-015). Admin only. The service fetches the
// delivered orders it needs and hands them to the pure functions in
// @mt/core reports.ts (FR-078), so the numbers follow one definition.
// ~2k orders a year is a small read; no SQL aggregation is needed.

import { buildReport, type DailyOrdersPoint, localDay, type MonthlyRevenuePoint, type Report, summarize } from "@mt/core";
import { DEFAULT_TIMEZONE, getReportsSchema } from "@mt/schemas";

import { z } from "zod";

import { defineService } from "../../service";

export interface MonthlyReportRow extends MonthlyRevenuePoint {
  readonly orderCount: number;
  readonly averageTicketCents: number;
}

export interface ReportsView extends Omit<Report, "monthly"> {
  readonly period: { readonly from: string; readonly to: string };
  readonly timezone: string;
  readonly monthly: MonthlyReportRow[];
  readonly daily: DailyOrdersPoint[];
}

const DAY_MS = 86_400_000;

/** Earliest instant any section can need: the period start, or six months back (186 days), with margin. */
function lowerBound(fromDay: string, now: Date): Date {
  const fromMs = Date.parse(`${fromDay}T00:00:00Z`) - 2 * DAY_MS;
  const monthsMs = now.getTime() - 200 * DAY_MS;
  return new Date(Math.min(fromMs, monthsMs));
}

export const getReports = defineService({
  name: "reports.get",
  minRole: "admin",
  input: getReportsSchema,
  run: async ({ tx, ctx, deps, input }): Promise<ReportsView> => {
    const [settings] = await tx<{ timezone: string }[]>`
      select timezone from public.restaurant_settings where restaurant_id = ${ctx.restaurantId}
    `;
    const timezone = settings?.timezone ?? DEFAULT_TIMEZONE;
    const now = deps.clock.now();
    const since = lowerBound(input.from, now);

    const orderRows = await tx<
      { id: string; customer_id: string; total_cents: number; delivered_at: Date }[]
    >`
      select id, customer_id, total_cents, delivered_at
      from public.orders
      where restaurant_id = ${ctx.restaurantId} and status = 'entregue' and delivered_at >= ${since}
    `;
    const itemRows = await tx<{ order_id: string; name: string; qty: number }[]>`
      select i.order_id, i.name, i.qty
      from public.order_items i
      join public.orders o on o.restaurant_id = i.restaurant_id and o.id = i.order_id
      where i.restaurant_id = ${ctx.restaurantId} and o.status = 'entregue' and o.delivered_at >= ${since}
    `;
    const itemsByOrder = new Map<string, { name: string; qty: number }[]>();
    for (const r of itemRows) {
      const list = itemsByOrder.get(r.order_id) ?? [];
      list.push({ name: r.name, qty: r.qty });
      itemsByOrder.set(r.order_id, list);
    }
    const orders = orderRows.map((r) => ({
      id: r.id,
      customerId: r.customer_id,
      status: "entregue" as const,
      totalCents: r.total_cents,
      deliveredAt: r.delivered_at,
      items: itemsByOrder.get(r.id) ?? [],
    }));

    const report = buildReport(orders, { fromDay: input.from, toDay: input.to }, timezone, now);
    const monthly = report.monthly.map((point) => {
      const month = summarize(orders, { fromDay: `${point.month}-01`, toDay: `${point.month}-31` }, timezone);
      return { ...point, orderCount: month.orderCount, averageTicketCents: month.averageTicketCents };
    });
    return { ...report, monthly, period: { from: input.from, to: input.to }, timezone };
  },
});

export interface ReportPeriodDefault {
  readonly from: string;
  readonly to: string;
  /** Today in the restaurant timezone, `YYYY-MM-DD`. */
  readonly today: string;
  readonly timezone: string;
}

/** Default period of the reports screen: the first of the current local month through today. */
export const getReportPeriodDefault = defineService({
  name: "reports.periodDefault",
  minRole: "admin",
  input: z.undefined(),
  run: async ({ tx, ctx, deps }): Promise<ReportPeriodDefault> => {
    const [settings] = await tx<{ timezone: string }[]>`
      select timezone from public.restaurant_settings where restaurant_id = ${ctx.restaurantId}
    `;
    const timezone = settings?.timezone ?? DEFAULT_TIMEZONE;
    const today = localDay(deps.clock.now(), timezone);
    return { from: `${today.slice(0, 7)}-01`, to: today, today, timezone };
  },
});
