// Report aggregations (FR-070..FR-078, ADR-015). Pure functions over plain arrays that
// packages/db feeds. A "counted" order is `finalizado` (ADR-028); its report date is `delivered_at`
// in the restaurant timezone. Money is integer cents.

import { localDay, localParts } from "./business-hours";
import type { OrderStatus } from "./order-status";

export interface ReportOrderItem {
  readonly name: string;
  readonly qty: number;
}

export interface ReportOrder {
  readonly id: string;
  readonly customerId: string;
  readonly status: OrderStatus;
  readonly totalCents: number;
  readonly deliveredAt: Date | null;
  readonly items?: readonly ReportOrderItem[];
}

/** Inclusive local days, `YYYY-MM-DD`, in the restaurant timezone. */
export interface ReportPeriod {
  readonly fromDay: string;
  readonly toDay: string;
}

export interface ReportSummary {
  readonly revenueCents: number;
  readonly orderCount: number;
  readonly averageTicketCents: number;
  readonly activeCustomers: number;
}

interface Counted {
  readonly order: ReportOrder;
  readonly day: string;
}

function counted(orders: readonly ReportOrder[], timezone: string): Counted[] {
  const out: Counted[] = [];
  for (const order of orders) {
    if (order.status === "finalizado" && order.deliveredAt) {
      out.push({ order, day: localDay(order.deliveredAt, timezone) });
    }
  }
  return out;
}

function inPeriod(day: string, period: ReportPeriod): boolean {
  return day >= period.fromDay && day <= period.toDay;
}

/** Revenue divided by count, rounded half up to the cent; zero when the count is zero (FR-072). */
export function averageTicketCents(revenueCents: number, count: number): number {
  if (count === 0) return 0;
  return Math.floor((2 * revenueCents + count) / (2 * count));
}

export function summarize(orders: readonly ReportOrder[], period: ReportPeriod, timezone: string): ReportSummary {
  const rows = counted(orders, timezone).filter((c) => inPeriod(c.day, period));
  const revenueCents = rows.reduce((sum, c) => sum + c.order.totalCents, 0);
  const orderCount = rows.length;
  return {
    revenueCents,
    orderCount,
    averageTicketCents: averageTicketCents(revenueCents, orderCount),
    activeCustomers: new Set(rows.map((c) => c.order.customerId)).size,
  };
}

export interface MonthlyRevenuePoint {
  /** `YYYY-MM`, local. */
  readonly month: string;
  readonly revenueCents: number;
}

/** Last `months` calendar months in order, the current one last, empty months at zero (FR-074). */
export function monthlyRevenue(
  orders: readonly ReportOrder[],
  timezone: string,
  now: Date,
  months = 6,
): MonthlyRevenuePoint[] {
  const cur = localParts(now, timezone);
  const points: MonthlyRevenuePoint[] = [];
  for (let back = months - 1; back >= 0; back--) {
    const d = new Date(Date.UTC(cur.year, cur.month - 1 - back, 1));
    points.push({
      month: `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      revenueCents: 0,
    });
  }
  const index = new Map(points.map((p, i) => [p.month, i]));
  const sums = points.map(() => 0);
  for (const c of counted(orders, timezone)) {
    const i = index.get(c.day.slice(0, 7));
    if (i !== undefined) sums[i] = (sums[i] ?? 0) + c.order.totalCents;
  }
  return points.map((p, i) => ({ month: p.month, revenueCents: sums[i] ?? 0 }));
}

export interface DailyOrdersPoint {
  readonly day: string;
  readonly orders: number;
  readonly revenueCents: number;
}

/** Last `days` local days in order, today last, empty days at zero (FR-075). */
export function dailyOrders(
  orders: readonly ReportOrder[],
  timezone: string,
  now: Date,
  days = 14,
): DailyOrdersPoint[] {
  const cur = localParts(now, timezone);
  const list: string[] = [];
  for (let back = days - 1; back >= 0; back--) {
    const d = new Date(Date.UTC(cur.year, cur.month - 1, cur.day - back));
    list.push(
      `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`,
    );
  }
  const counts = new Map(list.map((d) => [d, { orders: 0, revenueCents: 0 }]));
  for (const c of counted(orders, timezone)) {
    const slot = counts.get(c.day);
    if (slot) {
      slot.orders += 1;
      slot.revenueCents += c.order.totalCents;
    }
  }
  return list.map((day) => ({ day, ...(counts.get(day) as { orders: number; revenueCents: number }) }));
}

export interface TopItem {
  readonly name: string;
  readonly qty: number;
}

const collator = new Intl.Collator("pt-BR");

/** Best sellers by quantity from counted orders in the period; ties break by name (FR-076). */
export function topItems(orders: readonly ReportOrder[], period: ReportPeriod, timezone: string, limit = 8): TopItem[] {
  const totals = new Map<string, number>();
  for (const c of counted(orders, timezone)) {
    if (!inPeriod(c.day, period)) continue;
    for (const item of c.order.items ?? []) {
      totals.set(item.name, (totals.get(item.name) ?? 0) + item.qty);
    }
  }
  return [...totals.entries()]
    .map(([name, qty]) => ({ name, qty }))
    .sort(
      (a, b) => b.qty - a.qty || collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    )
    .slice(0, limit);
}

/** Percent change with one decimal; null when the previous value is zero, never infinity (FR-077). */
export function revenueGrowthPercent(currentCents: number, previousCents: number): number | null {
  if (previousCents === 0) return null;
  return Math.round(((currentCents - previousCents) * 1000) / previousCents) / 10;
}

export interface Report {
  readonly summary: ReportSummary;
  readonly monthly: MonthlyRevenuePoint[];
  readonly daily: DailyOrdersPoint[];
  readonly topItems: TopItem[];
  /** Current month against the previous one; null when the previous month is zero. */
  readonly revenueGrowthPercent: number | null;
}

export function buildReport(orders: readonly ReportOrder[], period: ReportPeriod, timezone: string, now: Date): Report {
  const monthly = monthlyRevenue(orders, timezone, now);
  const current = monthly[monthly.length - 1]?.revenueCents ?? 0;
  const previous = monthly[monthly.length - 2]?.revenueCents ?? 0;
  return {
    summary: summarize(orders, period, timezone),
    monthly,
    daily: dailyOrders(orders, timezone, now),
    topItems: topItems(orders, period, timezone),
    revenueGrowthPercent: revenueGrowthPercent(current, previous),
  };
}
