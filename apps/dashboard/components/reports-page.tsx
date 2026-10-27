"use client";

import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell
} from "recharts";
import {
  BarChart3, DollarSign, ShoppingBag, Users, TrendingUp, Award
} from "lucide-react";
import { cn } from "@mt/ui/lib/utils";
import Link from "next/link";
import type { ReportsView } from "@mt/http";
import { addDays, formatBRL, formatDayLabel, formatMonthLabel } from "@/components/admin-format";

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon: Icon, iconClass,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  iconClass: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-start gap-4">
      <div className={cn("flex items-center justify-center w-10 h-10 rounded-lg shrink-0", iconClass)}>
        <Icon className="w-5 h-5" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className="text-xl font-bold text-foreground leading-tight mt-0.5">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

function RevenueTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-md text-sm">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      <p className="text-primary">{formatBRL(Math.round(Number(payload[0]?.value ?? 0) * 100))}</p>
      <p className="text-muted-foreground text-xs">{payload[1]?.value} pedidos</p>
    </div>
  );
}

function DailyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-md text-sm">
      <p className="font-semibold text-foreground">{label}</p>
      <p className="text-primary">{payload[0]?.value} pedidos</p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ReportsPage({
  report,
  today,
  periodError,
}: {
  report: ReportsView;
  today: string;
  periodError: string | null;
}) {
  const { summary, topItems } = report;
  const monthlyData = report.monthly.map((m) => ({
    month: formatMonthLabel(m.month),
    revenue: m.revenueCents / 100,
    orders: m.orderCount,
    revenueCents: m.revenueCents,
    avgTicketCents: m.averageTicketCents,
  }));
  const dailyData = report.daily.map((d) => ({ day: formatDayLabel(d.day), orders: d.orders }));
  const growth = report.revenueGrowthPercent;
  const isGrowthPositive = growth !== null && growth >= 0;
  const presets = [
    { label: "Este mês", from: `${today.slice(0, 7)}-01`, to: today },
    { label: "Últimos 30 dias", from: addDays(today, -29), to: today },
    { label: "Últimos 90 dias", from: addDays(today, -89), to: today },
  ];

  // Top items bar chart color
  const barColors = [
    "var(--primary)",
    "oklch(0.65 0.16 45)",
    "oklch(0.7 0.14 50)",
    "var(--chart-5)",
    "oklch(0.74 0.10 58)",
    "oklch(0.76 0.08 60)",
    "oklch(0.78 0.06 62)",
    "oklch(0.80 0.04 65)",
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-card shrink-0">
        <BarChart3 className="w-5 h-5 text-primary" aria-hidden="true" />
        <h1 className="text-lg font-semibold text-foreground">Relatórios</h1>
        <form method="get" className="ml-auto flex flex-wrap items-center gap-2 text-sm">
          <label className="sr-only" htmlFor="report-from">De</label>
          <input id="report-from" type="date" name="from" defaultValue={report.period.from} max={today}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm" />
          <span className="text-muted-foreground">até</span>
          <label className="sr-only" htmlFor="report-to">Até</label>
          <input id="report-to" type="date" name="to" defaultValue={report.period.to} max={today}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm" />
          <button type="submit" className="rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground">
            Aplicar
          </button>
        </form>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {presets.map((p) => (
            <Link
              key={p.label}
              href={`/reports?from=${p.from}&to=${p.to}`}
              className={cn(
                "rounded-full border border-border px-3 py-1 text-muted-foreground hover:bg-muted",
                p.from === report.period.from && p.to === report.period.to && "bg-primary/10 font-semibold text-primary",
              )}
            >
              {p.label}
            </Link>
          ))}
          {periodError && <span role="alert" className="text-red-600 dark:text-red-300">{periodError}</span>}
        </div>
        {/* KPI row */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="Faturamento"
            value={formatBRL(summary.revenueCents)}
            sub="pedidos finalizados no período"
            icon={DollarSign}
            iconClass="bg-primary/10 text-primary"
          />
          <KpiCard
            label="Pedidos finalizados"
            value={String(summary.orderCount)}
            sub="no período"
            icon={ShoppingBag}
            iconClass="bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-300"
          />
          <KpiCard
            label="Ticket médio"
            value={formatBRL(summary.averageTicketCents)}
            sub="por pedido"
            icon={TrendingUp}
            iconClass="bg-green-100 dark:bg-green-500/15 text-green-600 dark:text-green-300"
          />
          <KpiCard
            label="Clientes ativos"
            value={String(summary.activeCustomers)}
            sub="com pedido finalizado no período"
            icon={Users}
            iconClass="bg-blue-100 dark:bg-blue-500/15 text-blue-600 dark:text-blue-300"
          />
        </div>

        {/* Charts row: Revenue + Daily */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Monthly revenue bar chart */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-sm font-semibold text-foreground">Faturamento Mensal</p>
                <p className="text-xs text-muted-foreground">Receita e pedidos por mês</p>
              </div>
              {growth !== null && (
                <span
                  className={cn(
                    "text-xs font-semibold px-2 py-1 rounded-full",
                    isGrowthPositive
                      ? "bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-300"
                      : "bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300"
                  )}
                >
                  {isGrowthPositive ? "+" : ""}{growth.toLocaleString("pt-BR", { minimumFractionDigits: 1 })}% vs mês ant.
                </span>
              )}
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyData} barSize={28}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `R$${(v / 1000).toFixed(1)}k`}
                  width={52}
                />
                <Tooltip content={<RevenueTooltip />} />
                <Bar dataKey="revenue" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="orders" fill="var(--chart-5)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-4 mt-2 justify-center">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="w-3 h-3 rounded-sm bg-primary" />
                Faturamento
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="w-3 h-3 rounded-sm" style={{ background: "var(--chart-5)" }} />
                Pedidos
              </div>
            </div>
          </div>

          {/* Daily orders line chart */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="mb-4">
              <p className="text-sm font-semibold text-foreground">Pedidos por Dia</p>
              <p className="text-xs text-muted-foreground">Últimos 14 dias</p>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  interval={2}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                />
                <Tooltip content={<DailyTooltip />} />
                <Line
                  type="monotone"
                  dataKey="orders"
                  stroke="var(--primary)"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "var(--primary)" }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top items */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-5">
            <Award className="w-4 h-4 text-primary" aria-hidden="true" />
            <p className="text-sm font-semibold text-foreground">Itens Mais Vendidos</p>
          </div>
          <div className="space-y-3">
            {topItems.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum pedido finalizado no período.</p>
            )}
            {topItems.map((item, index) => {
              const maxQty = topItems[0]?.qty ?? 1;
              const pct = Math.round((item.qty / maxQty) * 100);
              return (
                <div key={item.name} className="flex items-center gap-3">
                  {/* Rank */}
                  <span className="text-xs font-bold text-muted-foreground w-4 shrink-0 text-center">
                    {index + 1}
                  </span>
                  {/* Name + bar */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-foreground truncate">{item.name}</span>
                      <span className="text-xs text-muted-foreground ml-2 shrink-0">{item.qty} un.</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, background: barColors[index] ?? barColors[barColors.length - 1] }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Monthly summary table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <p className="text-sm font-semibold text-foreground">Resumo Mensal</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-5 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Mês</th>
                <th className="px-5 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">Faturamento</th>
                <th className="px-5 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right hidden sm:table-cell">Pedidos</th>
                <th className="px-5 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right hidden md:table-cell">Ticket médio</th>
              </tr>
            </thead>
            <tbody>
              {monthlyData.map((row, i) => (
                <tr
                  key={row.month}
                  className={cn(
                    "border-t border-border transition-colors hover:bg-muted/30",
                    i === monthlyData.length - 1 && "bg-primary/5 font-semibold"
                  )}
                >
                  <td className="px-5 py-3 text-foreground">{row.month}</td>
                  <td className="px-5 py-3 text-right text-foreground">
                    {formatBRL(row.revenueCents)}
                  </td>
                  <td className="px-5 py-3 text-right text-foreground hidden sm:table-cell">{row.orders}</td>
                  <td className="px-5 py-3 text-right text-foreground hidden md:table-cell">
                    {formatBRL(row.avgTicketCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
