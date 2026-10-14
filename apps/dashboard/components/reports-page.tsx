"use client";

import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell
} from "recharts";
import {
  BarChart3, DollarSign, ShoppingBag, Users, TrendingUp, Award
} from "lucide-react";
import { cn } from "@mt/ui/lib/utils";
import {
  monthlyData,
  dailyData,
  topItems,
  contacts,
  orders as allOrders,
} from "@/lib/marmita-data";

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
      <p className="text-primary">
        R$ {Number(payload[0]?.value ?? 0).toFixed(2).replace(".", ",")}
      </p>
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

export function ReportsPage() {
  // Summary KPIs
  const totalRevenue = monthlyData.reduce((s, m) => s + m.revenue, 0);
  const totalOrders = monthlyData.reduce((s, m) => s + m.orders, 0);
  const avgTicket = totalRevenue / totalOrders;
  const totalClients = contacts.length;
  const currentMonth = monthlyData[monthlyData.length - 1];
  const prevMonth = monthlyData[monthlyData.length - 2];
  const revenueGrowth = (((currentMonth.revenue - prevMonth.revenue) / prevMonth.revenue) * 100).toFixed(1);
  const isGrowthPositive = parseFloat(revenueGrowth) >= 0;

  // Top items bar chart color
  const barColors = [
    "oklch(0.6 0.18 40)",
    "oklch(0.65 0.16 45)",
    "oklch(0.7 0.14 50)",
    "oklch(0.72 0.12 55)",
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
        <span className="ml-auto text-xs text-muted-foreground">Últimos 6 meses</span>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        {/* KPI row */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="Faturamento total"
            value={`R$ ${totalRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
            sub="últimos 6 meses"
            icon={DollarSign}
            iconClass="bg-primary/10 text-primary"
          />
          <KpiCard
            label="Total de pedidos"
            value={String(totalOrders)}
            sub="últimos 6 meses"
            icon={ShoppingBag}
            iconClass="bg-amber-100 text-amber-600"
          />
          <KpiCard
            label="Ticket médio"
            value={`R$ ${avgTicket.toFixed(2).replace(".", ",")}`}
            sub="por pedido"
            icon={TrendingUp}
            iconClass="bg-green-100 text-green-600"
          />
          <KpiCard
            label="Clientes ativos"
            value={String(totalClients)}
            sub="na base"
            icon={Users}
            iconClass="bg-blue-100 text-blue-600"
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
              <span
                className={cn(
                  "text-xs font-semibold px-2 py-1 rounded-full",
                  isGrowthPositive
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-700"
                )}
              >
                {isGrowthPositive ? "+" : ""}{revenueGrowth}% vs mês ant.
              </span>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyData} barSize={28}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.88 0.015 55)" vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 12, fill: "oklch(0.5 0.02 50)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "oklch(0.5 0.02 50)" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `R$${(v / 1000).toFixed(1)}k`}
                  width={52}
                />
                <Tooltip content={<RevenueTooltip />} />
                <Bar dataKey="revenue" fill="oklch(0.6 0.18 40)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="orders" fill="oklch(0.72 0.12 55)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-4 mt-2 justify-center">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="w-3 h-3 rounded-sm bg-primary" />
                Faturamento
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="w-3 h-3 rounded-sm" style={{ background: "oklch(0.72 0.12 55)" }} />
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
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.88 0.015 55)" vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10, fill: "oklch(0.5 0.02 50)" }}
                  axisLine={false}
                  tickLine={false}
                  interval={2}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "oklch(0.5 0.02 50)" }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                />
                <Tooltip content={<DailyTooltip />} />
                <Line
                  type="monotone"
                  dataKey="orders"
                  stroke="oklch(0.6 0.18 40)"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "oklch(0.6 0.18 40)" }}
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
            {topItems.map((item, index) => {
              const maxQty = topItems[0].qty;
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
                  {/* Revenue */}
                  <span className="text-sm font-semibold text-foreground shrink-0 w-24 text-right">
                    R$ {item.revenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </span>
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
                    R$ {row.revenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-5 py-3 text-right text-foreground hidden sm:table-cell">{row.orders}</td>
                  <td className="px-5 py-3 text-right text-foreground hidden md:table-cell">
                    R$ {row.avgTicket.toFixed(2).replace(".", ",")}
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
