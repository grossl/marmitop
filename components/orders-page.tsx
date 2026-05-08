"use client";

import { useState, useMemo } from "react";
import {
  ClipboardList, Search, ChevronDown, TrendingUp,
  CheckCircle2, Clock, XCircle, DollarSign
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  orders as allOrders,
  contacts,
  statusLabels,
  paymentLabels,
  type Order,
  type OrderStatus,
} from "@/lib/marmita-data";

// ─── Status style map ──────────────────────────────────────────────────────────

const statusStyles: Record<OrderStatus, string> = {
  novo:       "bg-blue-100 text-blue-700 border-blue-200",
  preparando: "bg-amber-100 text-amber-700 border-amber-200",
  pronto:     "bg-green-100 text-green-700 border-green-200",
  entregue:   "bg-muted text-muted-foreground border-border",
  cancelado:  "bg-red-100 text-red-700 border-red-200",
};

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon: Icon, color,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-start gap-4">
      <div className={cn("flex items-center justify-center w-10 h-10 rounded-lg shrink-0", color)}>
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

// ─── Main component ───────────────────────────────────────────────────────────

export function OrdersPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "todos">("todos");
  const [page, setPage] = useState(1);
  const perPage = 8;

  const contactMap = useMemo(
    () => Object.fromEntries(contacts.map((c) => [c.id, c])),
    []
  );

  const filtered = useMemo(() => {
    return allOrders.filter((o) => {
      const contact = contactMap[o.contactId];
      const term = search.toLowerCase();
      const matchesSearch =
        !term ||
        o.id.toLowerCase().includes(term) ||
        contact?.name.toLowerCase().includes(term) ||
        o.items.some((i) => i.name.toLowerCase().includes(term));
      const matchesStatus = statusFilter === "todos" || o.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [search, statusFilter, contactMap]);

  const totalPages = Math.ceil(filtered.length / perPage);
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  // KPIs
  const today = allOrders.filter((o) => o.date === "2025-05-07");
  const todayRevenue = today.filter((o) => o.status !== "cancelado").reduce((s, o) => s + o.total, 0);
  const activeOrders = allOrders.filter((o) => ["novo", "preparando", "pronto"].includes(o.status)).length;
  const deliveredToday = today.filter((o) => o.status === "entregue").length;
  const canceledTotal = allOrders.filter((o) => o.status === "cancelado").length;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-card shrink-0">
        <ClipboardList className="w-5 h-5 text-primary" aria-hidden="true" />
        <h1 className="text-lg font-semibold text-foreground">Pedidos</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* KPI row */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="Faturamento hoje"
            value={`R$ ${todayRevenue.toFixed(2).replace(".", ",")}`}
            sub={`${today.length} pedidos no dia`}
            icon={DollarSign}
            color="bg-primary/10 text-primary"
          />
          <KpiCard
            label="Em andamento"
            value={String(activeOrders)}
            sub="novo + preparando + pronto"
            icon={Clock}
            color="bg-amber-100 text-amber-600"
          />
          <KpiCard
            label="Entregues hoje"
            value={String(deliveredToday)}
            sub="pedidos concluídos"
            icon={CheckCircle2}
            color="bg-green-100 text-green-600"
          />
          <KpiCard
            label="Cancelados"
            value={String(canceledTotal)}
            sub="total histórico"
            icon={XCircle}
            color="bg-red-100 text-red-500"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              placeholder="Buscar por pedido, cliente ou item..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(v) => { setStatusFilter(v as OrderStatus | "todos"); setPage(1); }}
          >
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os status</SelectItem>
              {(Object.keys(statusLabels) as OrderStatus[]).map((s) => (
                <SelectItem key={s} value={s}>{statusLabels[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="font-semibold text-foreground w-28">Pedido</TableHead>
                <TableHead className="font-semibold text-foreground">Cliente</TableHead>
                <TableHead className="font-semibold text-foreground hidden md:table-cell">Itens</TableHead>
                <TableHead className="font-semibold text-foreground hidden lg:table-cell">Pagamento</TableHead>
                <TableHead className="font-semibold text-foreground hidden sm:table-cell">Data</TableHead>
                <TableHead className="font-semibold text-foreground text-right">Total</TableHead>
                <TableHead className="font-semibold text-foreground">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                    Nenhum pedido encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map((order) => {
                  const contact = contactMap[order.contactId];
                  return (
                    <TableRow key={order.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-mono text-sm font-medium text-primary">
                        {order.id}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">
                            {contact?.avatar ?? "?"}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{contact?.name ?? "—"}</p>
                            <p className="text-xs text-muted-foreground">{contact?.phone}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <ul className="space-y-0.5">
                          {order.items.map((item, i) => (
                            <li key={i} className="text-sm text-foreground">
                              <span className="font-medium">{item.qty}x</span> {item.name}
                              {item.obs && (
                                <span className="text-xs text-muted-foreground block">{item.obs}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                        {paymentLabels[order.payment]}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground whitespace-nowrap">
                        {new Date(order.date + "T00:00:00").toLocaleDateString("pt-BR")}
                        <span className="block text-xs">{order.createdAt}</span>
                      </TableCell>
                      <TableCell className="text-right font-semibold text-foreground whitespace-nowrap">
                        R$ {order.total.toFixed(2).replace(".", ",")}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn("text-xs font-medium border", statusStyles[order.status])}
                        >
                          {statusLabels[order.status]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {filtered.length} pedido{filtered.length !== 1 ? "s" : ""}
              {" — "}página {page} de {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline" size="sm"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Anterior
              </Button>
              <Button
                variant="outline" size="sm"
                disabled={page === totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
