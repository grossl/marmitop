"use client";

import { useState, useMemo } from "react";
import {
  ClipboardList,
  Search,
  Clock,
  CheckCircle2,
  DollarSign,
  MapPin,
  CreditCard,
  ChevronRight,
  Package,
  Bike,
  UtensilsCrossed,
  AlertCircle,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  orders as allOrders,
  contacts,
  statusLabels,
  paymentLabels,
  type Order,
  type OrderStatus,
} from "@/lib/marmita-data";

// ─── Column config ─────────────────────────────────────────────────────────────

const COLUMNS: {
  status: OrderStatus;
  label: string;
  icon: React.ElementType;
  accent: string;
  badgeClass: string;
  headerClass: string;
  colClass: string;
}[] = [
  {
    status: "aguardando",
    label: "Aguardando Confirmação",
    icon: AlertCircle,
    accent: "text-yellow-600",
    badgeClass: "bg-yellow-50 text-yellow-700 border-yellow-200",
    headerClass: "border-yellow-300 bg-yellow-50",
    colClass: "border-yellow-200 bg-yellow-50/30",
  },
  {
    status: "confirmado",
    label: "Confirmado",
    icon: CheckCircle2,
    accent: "text-blue-600",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
    headerClass: "border-blue-300 bg-blue-50",
    colClass: "border-blue-200 bg-blue-50/30",
  },
  {
    status: "preparando",
    label: "Em Preparo",
    icon: UtensilsCrossed,
    accent: "text-orange-600",
    badgeClass: "bg-orange-50 text-orange-700 border-orange-200",
    headerClass: "border-orange-300 bg-orange-50",
    colClass: "border-orange-200 bg-orange-50/30",
  },
  {
    status: "pronto",
    label: "Pronto",
    icon: Package,
    accent: "text-green-600",
    badgeClass: "bg-green-50 text-green-700 border-green-200",
    headerClass: "border-green-300 bg-green-50",
    colClass: "border-green-200 bg-green-50/30",
  },
  {
    status: "saiu",
    label: "Saiu para Entrega",
    icon: Bike,
    accent: "text-purple-600",
    badgeClass: "bg-purple-50 text-purple-700 border-purple-200",
    headerClass: "border-purple-300 bg-purple-50",
    colClass: "border-purple-200 bg-purple-50/30",
  },
];

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-start gap-3">
      <div className={cn("flex items-center justify-center w-9 h-9 rounded-lg shrink-0", color)}>
        <Icon className="w-4 h-4" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground font-medium leading-tight">{label}</p>
        <p className="text-xl font-bold text-foreground leading-tight mt-0.5">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Order card ───────────────────────────────────────────────────────────────

function OrderCard({
  order,
  badgeClass,
  onAdvance,
  isLast,
}: {
  order: Order;
  badgeClass: string;
  onAdvance?: () => void;
  isLast: boolean;
}) {
  const contact = contacts.find((c) => c.id === order.contactId);

  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3 shadow-sm hover:shadow-md transition-shadow">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
            {contact?.avatar ?? "?"}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate leading-tight">
              {contact?.name ?? "—"}
            </p>
            <p className="text-xs text-muted-foreground font-mono">{order.id}</p>
          </div>
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">{order.createdAt}</span>
      </div>

      {/* Items */}
      <ul className="space-y-1">
        {order.items.map((item, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span className="text-xs font-bold text-primary shrink-0 mt-0.5">{item.qty}x</span>
            <div className="min-w-0">
              <span className="text-xs font-medium text-foreground leading-tight">{item.name}</span>
              {item.obs && (
                <p className="text-xs text-muted-foreground italic leading-tight">{item.obs}</p>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* Address */}
      <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
        <span className="truncate">{order.address}</span>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-border">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CreditCard className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{paymentLabels[order.payment]}</span>
        </div>
        <span className="text-sm font-bold text-foreground">
          R$ {order.total.toFixed(2).replace(".", ",")}
        </span>
      </div>

      {/* Advance button */}
      {!isLast && (
        <Button
          size="sm"
          variant="outline"
          className="w-full text-xs h-7 gap-1"
          onClick={onAdvance}
        >
          Avançar status
          <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

// ─── Kanban column ────────────────────────────────────────────────────────────

function KanbanColumn({
  col,
  orders,
  onAdvance,
}: {
  col: (typeof COLUMNS)[number];
  orders: Order[];
  onAdvance: (orderId: string) => void;
}) {
  const Icon = col.icon;
  const isLast = col.status === "saiu";

  return (
    <div className={cn("flex flex-col rounded-xl border min-w-[260px] flex-1", col.colClass)}>
      {/* Column header */}
      <div className={cn("flex items-center gap-2 px-4 py-3 rounded-t-xl border-b", col.headerClass)}>
        <Icon className={cn("w-4 h-4 shrink-0", col.accent)} aria-hidden="true" />
        <span className="text-sm font-semibold text-foreground flex-1 leading-tight">{col.label}</span>
        <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full border", col.badgeClass)}>
          {orders.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-3 p-3 overflow-y-auto flex-1">
        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Icon className="w-7 h-7 text-muted-foreground/40 mb-2" aria-hidden="true" />
            <p className="text-xs text-muted-foreground">Nenhum pedido aqui</p>
          </div>
        ) : (
          orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              badgeClass={col.badgeClass}
              isLast={isLast}
              onAdvance={() => onAdvance(order.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const STATUS_FLOW: OrderStatus[] = ["aguardando", "confirmado", "preparando", "pronto", "saiu"];

export function OrdersPage() {
  const [search, setSearch] = useState("");
  const [orderList, setOrderList] = useState<Order[]>(allOrders);

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    if (!term) return orderList;
    return orderList.filter((o) => {
      const contact = contacts.find((c) => c.id === o.contactId);
      return (
        o.id.toLowerCase().includes(term) ||
        contact?.name.toLowerCase().includes(term) ||
        o.items.some((i) => i.name.toLowerCase().includes(term))
      );
    });
  }, [search, orderList]);

  function advanceOrder(orderId: string) {
    setOrderList((prev) =>
      prev.map((o) => {
        if (o.id !== orderId) return o;
        const idx = STATUS_FLOW.indexOf(o.status);
        if (idx === -1 || idx >= STATUS_FLOW.length - 1) return o;
        return { ...o, status: STATUS_FLOW[idx + 1] };
      })
    );
  }

  // KPIs
  const activeCount = orderList.filter((o) =>
    ["aguardando", "confirmado", "preparando"].includes(o.status)
  ).length;
  const readyCount = orderList.filter((o) => o.status === "pronto").length;
  const outCount = orderList.filter((o) => o.status === "saiu").length;
  const todayRevenue = orderList.reduce((s, o) => s + o.total, 0);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-card shrink-0">
        <ClipboardList className="w-5 h-5 text-primary" aria-hidden="true" />
        <h1 className="text-lg font-semibold text-foreground">Pedidos</h1>
        <Badge variant="outline" className="ml-auto text-xs">
          {orderList.length} pedidos
        </Badge>
      </div>

      <div className="flex flex-col flex-1 overflow-hidden px-6 py-4 gap-4">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 shrink-0">
          <KpiCard
            label="Faturamento"
            value={`R$ ${todayRevenue.toFixed(2).replace(".", ",")}`}
            sub="todos os pedidos"
            icon={DollarSign}
            color="bg-primary/10 text-primary"
          />
          <KpiCard
            label="Em andamento"
            value={String(activeCount)}
            sub="aguardando + confirmado + preparo"
            icon={Clock}
            color="bg-amber-100 text-amber-600"
          />
          <KpiCard
            label="Prontos"
            value={String(readyCount)}
            sub="aguardando retirada"
            icon={Package}
            color="bg-green-100 text-green-600"
          />
          <KpiCard
            label="Saiu para entrega"
            value={String(outCount)}
            sub="a caminho do cliente"
            icon={Bike}
            color="bg-purple-100 text-purple-600"
          />
        </div>

        {/* Search */}
        <div className="relative shrink-0 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <Input
            placeholder="Buscar por pedido, cliente ou item..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Kanban board */}
        <div className="flex gap-4 flex-1 overflow-x-auto pb-2">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.status}
              col={col}
              orders={filtered.filter((o) => o.status === col.status)}
              onAdvance={advanceOrder}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
