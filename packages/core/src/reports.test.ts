// covers FR-070, FR-071, FR-072, FR-073, FR-074, FR-075, FR-076, FR-077, FR-078
import { describe, expect, test } from "bun:test";
import {
  averageTicketCents,
  buildReport,
  dailyOrders,
  monthlyRevenue,
  type ReportOrder,
  revenueGrowthPercent,
  summarize,
  topItems,
} from "./reports";

const SP = "America/Sao_Paulo";
const order = (
  id: string,
  customerId: string,
  status: ReportOrder["status"],
  totalCents: number,
  deliveredAt: string | null,
  items: { name: string; qty: number }[] = [],
): ReportOrder => ({
  id,
  customerId,
  status,
  totalCents,
  deliveredAt: deliveredAt ? new Date(deliveredAt) : null,
  items,
});

// "now" = Tuesday 2026-10-13 12:00 local (15:00Z)
const NOW = new Date("2026-10-13T15:00:00Z");

const orders: ReportOrder[] = [
  order("1", "c1", "entregue", 5000, "2026-10-13T14:00:00Z", [{ name: "Marmita Fit", qty: 2 }]),
  order("2", "c1", "entregue", 3001, "2026-10-12T20:00:00Z", [
    { name: "Marmita Fit", qty: 1 },
    { name: "Suco", qty: 1 },
  ]),
  order("3", "c2", "cancelado", 9999, null, [{ name: "Marmita Fit", qty: 9 }]),
  order("4", "c3", "preparando", 7000, null, [{ name: "Suco", qty: 5 }]),
  order("5", "c4", "cancelado", 2000, null),
  order("6", "c2", "entregue", 4500, "2026-09-30T01:00:00Z", [{ name: "Suco", qty: 3 }]), // Sep 29 22:00 local
];

describe("summarize (FR-070..FR-073)", () => {
  const period = { fromDay: "2026-10-01", toDay: "2026-10-31" };
  test("revenue counts entregue orders only; cancelled and open add nothing", () => {
    const s = summarize(orders, period, SP);
    expect(s.revenueCents).toBe(8001);
    expect(s.orderCount).toBe(2);
  });
  test("average ticket is rounded to the cent (half up)", () => {
    expect(summarize(orders, period, SP).averageTicketCents).toBe(4001); // 8001/2 = 4000.5 -> 4001
  });
  test("active customers: at least one entregue order in the period", () => {
    const s = summarize(orders, period, SP);
    expect(s.activeCustomers).toBe(1); // c1 only; c2 cancelled, c3 open
  });
  test("the report date is delivered_at in the restaurant timezone", () => {
    // order 6 was delivered at 2026-09-30T01:00Z = Sep 29 local, so it is not in October
    expect(summarize(orders, { fromDay: "2026-09-29", toDay: "2026-09-29" }, SP).revenueCents).toBe(4500);
    expect(summarize(orders, { fromDay: "2026-09-30", toDay: "2026-09-30" }, SP).revenueCents).toBe(0);
  });
  test("period bounds are inclusive local days", () => {
    expect(summarize(orders, { fromDay: "2026-10-12", toDay: "2026-10-12" }, SP).orderCount).toBe(1);
    expect(summarize(orders, { fromDay: "2026-10-12", toDay: "2026-10-13" }, SP).orderCount).toBe(2);
  });
  test("empty period gives zeros, no division error", () => {
    expect(summarize([], period, SP)).toEqual({
      revenueCents: 0,
      orderCount: 0,
      averageTicketCents: 0,
      activeCustomers: 0,
    });
  });
  test("an entregue order with no deliveredAt is ignored", () => {
    const odd = [order("x", "c1", "entregue", 100, null)];
    expect(summarize(odd, period, SP).orderCount).toBe(0);
  });
});

describe("averageTicketCents", () => {
  test("integer rounding rule: half rounds up, zero count is zero", () => {
    expect(averageTicketCents(0, 0)).toBe(0);
    expect(averageTicketCents(10, 3)).toBe(3); // 3.33
    expect(averageTicketCents(11, 3)).toBe(4); // 3.67
    expect(averageTicketCents(5, 2)).toBe(3); // 2.5 -> 3
    expect(averageTicketCents(7, 2)).toBe(4); // 3.5 -> 4
    expect(averageTicketCents(4, 2)).toBe(2);
  });
});

describe("monthlyRevenue (FR-074)", () => {
  test("six months in order, current month last, empty months are zero", () => {
    const m = monthlyRevenue(orders, SP, NOW);
    expect(m).toEqual([
      { month: "2026-05", revenueCents: 0 },
      { month: "2026-06", revenueCents: 0 },
      { month: "2026-07", revenueCents: 0 },
      { month: "2026-08", revenueCents: 0 },
      { month: "2026-09", revenueCents: 4500 },
      { month: "2026-10", revenueCents: 8001 },
    ]);
  });
  test("crosses a year boundary", () => {
    const m = monthlyRevenue([], SP, new Date("2026-02-10T12:00:00Z"));
    expect(m.map((x) => x.month)).toEqual(["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
  });
  test("uses the local month at a month boundary", () => {
    const edge = [order("e", "c", "entregue", 100, "2026-11-01T02:00:00Z")]; // Oct 31 23:00 local
    const m = monthlyRevenue(edge, SP, NOW);
    expect(m[5]).toEqual({ month: "2026-10", revenueCents: 100 });
  });
});

describe("dailyOrders (FR-075)", () => {
  test("fourteen days, oldest first, today last, empty days are zero", () => {
    const d = dailyOrders(orders, SP, NOW);
    expect(d.length).toBe(14);
    expect(d[0]?.day).toBe("2026-09-30");
    expect(d[13]?.day).toBe("2026-10-13");
    expect(d.find((x) => x.day === "2026-10-13")).toEqual({ day: "2026-10-13", orders: 1, revenueCents: 5000 });
    expect(d.find((x) => x.day === "2026-10-12")).toEqual({ day: "2026-10-12", orders: 1, revenueCents: 3001 });
    expect(d.find((x) => x.day === "2026-10-05")).toEqual({ day: "2026-10-05", orders: 0, revenueCents: 0 });
  });
  test("day boundaries use the restaurant timezone, not UTC", () => {
    const late = [order("l", "c", "entregue", 100, "2026-10-13T02:30:00Z")]; // Oct 12 23:30 local
    const d = dailyOrders(late, SP, NOW);
    expect(d.find((x) => x.day === "2026-10-12")?.orders).toBe(1);
    expect(d.find((x) => x.day === "2026-10-13")?.orders).toBe(0);
  });
  test("walks local days across a DST change without skipping or repeating a day", () => {
    const d = dailyOrders([], "America/New_York", new Date("2026-03-10T16:00:00Z"));
    expect(d.map((x) => x.day)).toEqual([
      "2026-02-25",
      "2026-02-26",
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
      "2026-03-10",
    ]);
  });
});

describe("topItems (FR-076)", () => {
  test("sums quantity over entregue orders only, descending, ties by name", () => {
    const t = topItems(orders, { fromDay: "2026-09-01", toDay: "2026-10-31" }, SP);
    expect(t).toEqual([
      { name: "Suco", qty: 4 },
      { name: "Marmita Fit", qty: 3 },
    ]);
  });
  test("ties break by name (pt collation), stable", () => {
    const o = [
      order("a", "c", "entregue", 1, "2026-10-13T14:00:00Z", [
        { name: "Zebra", qty: 2 },
        { name: "Árvore", qty: 2 },
        { name: "Beta", qty: 2 },
      ]),
    ];
    expect(topItems(o, { fromDay: "2026-10-01", toDay: "2026-10-31" }, SP).map((x) => x.name)).toEqual([
      "Árvore",
      "Beta",
      "Zebra",
    ]);
  });
  test("limited to eight rows by default", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ name: `Item ${String(i).padStart(2, "0")}`, qty: i + 1 }));
    const o = [order("a", "c", "entregue", 1, "2026-10-13T14:00:00Z", items)];
    const t = topItems(o, { fromDay: "2026-10-01", toDay: "2026-10-31" }, SP);
    expect(t.length).toBe(8);
    expect(t[0]).toEqual({ name: "Item 11", qty: 12 });
  });
  test("respects the period", () => {
    expect(topItems(orders, { fromDay: "2026-10-13", toDay: "2026-10-13" }, SP)).toEqual([
      { name: "Marmita Fit", qty: 2 },
    ]);
  });
});

describe("revenueGrowthPercent (FR-077)", () => {
  test("percent change with one decimal; null when the previous month is zero", () => {
    expect(revenueGrowthPercent(150, 100)).toBe(50);
    expect(revenueGrowthPercent(50, 100)).toBe(-50);
    expect(revenueGrowthPercent(8001, 4500)).toBe(77.8);
    expect(revenueGrowthPercent(0, 100)).toBe(-100);
    expect(revenueGrowthPercent(100, 0)).toBeNull();
    expect(revenueGrowthPercent(0, 0)).toBeNull();
  });
});

describe("buildReport", () => {
  test("bundles every aggregation", () => {
    const r = buildReport(orders, { fromDay: "2026-10-01", toDay: "2026-10-31" }, SP, NOW);
    expect(r.summary.revenueCents).toBe(8001);
    expect(r.monthly.length).toBe(6);
    expect(r.daily.length).toBe(14);
    expect(r.topItems[0]?.name).toBe("Marmita Fit");
    expect(r.revenueGrowthPercent).toBe(77.8);
  });
});
