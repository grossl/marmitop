"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  ClipboardList,
  Search,
  Clock,
  DollarSign,
  MapPin,
  CreditCard,
  Package,
  Bike,
  UtensilsCrossed,
  AlertCircle,
  CheckCircle2,
  CheckCheck,
  GripVertical,
  XCircle,
  CircleCheck,
} from "lucide-react";
import { Input } from "@mt/ui/components/input";
import { Badge } from "@mt/ui/components/badge";
import { Button } from "@mt/ui/components/button";
import { Textarea } from "@mt/ui/components/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@mt/ui/components/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mt/ui/components/select";
import { cn } from "@mt/ui/lib/utils";
import type { PaymentMethod } from "@mt/schemas";
import type { BoardOrder, OrderDetail, OrderKpis } from "@mt/http";
import { useRealtimeTable } from "@/lib/realtime";
import {
  PAYMENT_LABELS,
  STATUS_LABELS,
  paymentLabel,
  formatCents,
  formatDateTime,
  formatTime,
  initials,
  sourceLabel,
} from "@/components/orders-format";
import {
  cancelOrderAction,
  changeOrderStatusAction,
  getOrderAction,
  markOrderPaidAction,
  setOrderPaymentMethodAction,
  unmarkOrderPaidAction,
} from "@/app/(app)/orders/actions";
import { InvoiceBadge, InvoicePanel } from "@/components/invoice-panel";

type OrderStatus = BoardOrder["status"];

// ─── Column config ─────────────────────────────────────────────────────────────

const COLUMNS: {
  status: OrderStatus;
  label: string;
  icon: React.ElementType;
  accent: string;
  badgeClass: string;
  headerClass: string;
  colClass: string;
  dropClass: string;
}[] = [
  {
    status: "aguardando",
    label: "Aguardando",
    icon: AlertCircle,
    accent: "text-yellow-600 dark:text-yellow-300",
    badgeClass: "bg-yellow-50 dark:bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-500/30",
    headerClass: "border-yellow-300 dark:border-yellow-500/30 bg-yellow-50 dark:bg-yellow-500/15",
    colClass: "border-yellow-200 dark:border-yellow-500/30 bg-yellow-50/30 dark:bg-yellow-500/15",
    dropClass: "bg-yellow-100/60 dark:bg-yellow-500/20 border-yellow-300 dark:border-yellow-500/30",
  },
  {
    status: "confirmado",
    label: "Confirmado",
    icon: CheckCircle2,
    accent: "text-blue-600 dark:text-blue-300",
    badgeClass: "bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30",
    headerClass: "border-blue-300 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/15",
    colClass: "border-blue-200 dark:border-blue-500/30 bg-blue-50/30 dark:bg-blue-500/15",
    dropClass: "bg-blue-100/60 dark:bg-blue-500/20 border-blue-300 dark:border-blue-500/30",
  },
  {
    status: "preparando",
    label: "Em Preparo",
    icon: UtensilsCrossed,
    accent: "text-orange-600 dark:text-orange-300",
    badgeClass: "bg-orange-50 dark:bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-500/30",
    headerClass: "border-orange-300 dark:border-orange-500/30 bg-orange-50 dark:bg-orange-500/15",
    colClass: "border-orange-200 dark:border-orange-500/30 bg-orange-50/30 dark:bg-orange-500/15",
    dropClass: "bg-orange-100/60 dark:bg-orange-500/20 border-orange-300 dark:border-orange-500/30",
  },
  {
    status: "pronto",
    label: "Pronto",
    icon: Package,
    accent: "text-green-600 dark:text-green-300",
    badgeClass: "bg-green-50 dark:bg-green-500/15 text-green-700 dark:text-green-300 border-green-200 dark:border-green-500/30",
    headerClass: "border-green-300 dark:border-green-500/30 bg-green-50 dark:bg-green-500/15",
    colClass: "border-green-200 dark:border-green-500/30 bg-green-50/30 dark:bg-green-500/15",
    dropClass: "bg-green-100/60 dark:bg-green-500/20 border-green-300 dark:border-green-500/30",
  },
  {
    status: "saiu",
    label: "Saiu para Entrega",
    icon: Bike,
    accent: "text-purple-600 dark:text-purple-300",
    badgeClass: "bg-purple-50 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-500/30",
    headerClass: "border-purple-300 dark:border-purple-500/30 bg-purple-50 dark:bg-purple-500/15",
    colClass: "border-purple-200 dark:border-purple-500/30 bg-purple-50/30 dark:bg-purple-500/15",
    dropClass: "bg-purple-100/60 dark:bg-purple-500/20 border-purple-300 dark:border-purple-500/30",
  },
  {
    status: "entregue",
    label: "Entregue",
    icon: CheckCheck,
    accent: "text-slate-500 dark:text-slate-400",
    badgeClass: "bg-slate-100 dark:bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-500/30",
    headerClass: "border-slate-200 dark:border-slate-500/30 bg-slate-50 dark:bg-slate-500/15",
    colClass: "border-slate-200 dark:border-slate-500/30 bg-slate-50/30 dark:bg-slate-500/15",
    dropClass: "bg-slate-100/60 dark:bg-slate-500/20 border-slate-300 dark:border-slate-500/30",
  },
  {
    status: "cancelado",
    label: "Cancelado",
    icon: XCircle,
    accent: "text-red-500 dark:text-red-300",
    badgeClass: "bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30",
    headerClass: "border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15",
    colClass: "border-red-200 dark:border-red-500/30 bg-red-50/30 dark:bg-red-500/15",
    dropClass: "bg-red-100/60 dark:bg-red-500/20 border-red-300 dark:border-red-500/30",
  },
];

// ─── KPI card ──────────────────────────────────────────────────────────────────

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

// ─── Order card (draggable) ────────────────────────────────────────────────────

function OrderCard({
  order,
  timezone,
  isDragging = false,
  pending = false,
  highlighted = false,
  onOpen,
}: {
  order: BoardOrder;
  timezone: string;
  isDragging?: boolean;
  pending?: boolean;
  highlighted?: boolean;
  onOpen: (order: BoardOrder) => void;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: order.id,
    // FR-022: final orders cannot move; a request in flight blocks a second drag.
    disabled: pending || order.allowedStatuses.length === 0,
  });
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlighted]);

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  const movable = order.allowedStatuses.length > 0 && !pending;

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        ref.current = node;
      }}
      style={style}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(order)}
      className={cn(
        "bg-card border border-border rounded-xl p-4 flex flex-col gap-3 shadow-sm transition-all select-none",
        isDragging ? "opacity-40" : movable ? "hover:shadow-md cursor-grab active:cursor-grabbing" : "cursor-pointer",
        pending && "opacity-70",
        highlighted && "ring-2 ring-primary ring-offset-2 animate-pulse",
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <GripVertical className="w-4 h-4 text-muted-foreground/40 shrink-0" aria-hidden="true" />
          <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
            {initials(order.customerName)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate leading-tight">{order.customerName}</p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
              {order.code}
              {order.fromAi && <span className="rounded bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">IA</span>}
            </p>
          </div>
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
          {formatTime(order.createdAt, timezone)}
        </span>
      </div>

      {/* Items */}
      <ul className="space-y-1.5">
        {order.items.map((item, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span className="text-xs font-bold text-primary shrink-0 mt-0.5 min-w-[18px]">{item.qty}x</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-medium text-foreground leading-tight">{item.name}</span>
                {item.sizeName && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary leading-none shrink-0">
                    {item.sizeName}
                  </span>
                )}
              </div>
              {item.notes && <p className="text-xs text-muted-foreground italic leading-tight mt-0.5">{item.notes}</p>}
            </div>
          </li>
        ))}
      </ul>

      {/* Address */}
      <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
        <span className="truncate">{order.addressLine || "—"}</span>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-border">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
          <CreditCard className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{paymentLabel(order.paymentMethod)}</span>
          {/* FR-139: a small invoice badge when the order has an invoice */}
          {order.invoiceStatus && <InvoiceBadge status={order.invoiceStatus} className="ml-1" />}
        </div>
        <span className="text-sm font-bold text-foreground">{formatCents(order.totalCents)}</span>
      </div>
    </div>
  );
}

// ─── Kanban column (droppable) ─────────────────────────────────────────────────

function KanbanColumn({
  col,
  orders,
  activeId,
  pendingIds,
  highlightId,
  timezone,
  onOpen,
}: {
  col: (typeof COLUMNS)[number];
  orders: BoardOrder[];
  activeId: string | null;
  pendingIds: ReadonlySet<string>;
  highlightId: string | null;
  timezone: string;
  onOpen: (order: BoardOrder) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.status });
  const Icon = col.icon;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col rounded-xl border min-w-0 flex-1 overflow-hidden transition-colors duration-150",
        isOver ? col.dropClass : col.colClass,
      )}
    >
      {/* Column header */}
      <div className={cn("flex items-center gap-2 px-3 py-3 rounded-t-xl border-b", col.headerClass)}>
        <Icon className={cn("w-4 h-4 shrink-0", col.accent)} aria-hidden="true" />
        <span className="text-sm font-semibold text-foreground flex-1 leading-tight truncate">{col.label}</span>
        <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full border shrink-0", col.badgeClass)}>
          {orders.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-3 p-3 overflow-y-auto overflow-x-hidden flex-1 min-h-[80px]">
        {orders.length === 0 && !isOver ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <Icon className="w-6 h-6 text-muted-foreground/30 mb-1" aria-hidden="true" />
            <p className="text-xs text-muted-foreground/60">Nenhum pedido</p>
          </div>
        ) : (
          orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              timezone={timezone}
              isDragging={activeId === order.id}
              pending={pendingIds.has(order.id)}
              highlighted={highlightId === order.id}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Cancel dialog (FR-026) ────────────────────────────────────────────────────

function CancelDialog({
  order,
  busy,
  onConfirm,
  onClose,
}: {
  order: BoardOrder | null;
  busy: boolean;
  onConfirm: (order: BoardOrder, reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (order) setReason("");
  }, [order]);

  return (
    <Dialog open={order !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar pedido {order?.code}</DialogTitle>
          <DialogDescription>
            O pedido continua no histórico com o status Cancelado. Essa ação não pode ser desfeita.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          placeholder="Motivo do cancelamento (opcional)"
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Voltar
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => order && onConfirm(order, reason)}>
            Cancelar pedido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Payment mark (ADR-020; FR-161, FR-162) ────────────────────────────────────

function PaymentSection({
  orderId,
  status,
  paidAt,
  timezone,
  isAdmin,
  onChanged,
}: {
  orderId: string;
  status: string;
  paidAt: string | null;
  timezone: string;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const paid = paidAt !== null && status !== "cancelado";

  async function run(kind: "mark" | "unmark") {
    setBusy(true);
    const result = kind === "mark" ? await markOrderPaidAction({ orderId }) : await unmarkOrderPaidAction({ orderId });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success(kind === "mark" ? "Pedido marcado como pago." : "Pagamento desmarcado.");
    onChanged();
  }

  return (
    <div className="flex items-center justify-between gap-3 border-t pt-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold uppercase tracking-wide text-muted-foreground">Pagamento</span>
        {paid ? (
          <span className="inline-flex items-center gap-1 rounded border border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-green-700 dark:text-green-300">
            <CircleCheck className="h-3 w-3" aria-hidden="true" />
            Pago em {formatDateTime(paidAt, timezone)}
          </span>
        ) : (
          <span className="inline-flex items-center rounded border border-slate-200 dark:border-slate-500/30 bg-slate-100 dark:bg-slate-500/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-slate-600 dark:text-slate-400">
            Não pago
          </span>
        )}
      </div>
      {status !== "cancelado" && !paid && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("mark")}>
          Marcar como pago
        </Button>
      )}
      {paid && isAdmin && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("unmark")}>
          Desmarcar pagamento
        </Button>
      )}
    </div>
  );
}

/** FR-188: an order from the AI assistant has no method until staff pick one. */
function PaymentMethodPicker({ orderId, onChanged }: { orderId: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function choose(paymentMethod: string) {
    setBusy(true);
    const result = await setOrderPaymentMethodAction({ orderId, paymentMethod: paymentMethod as PaymentMethod });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Forma de pagamento definida.");
    onChanged();
  }

  return (
    <div className="flex items-center justify-between gap-3 border-t pt-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pagamento</span>
      <Select disabled={busy} onValueChange={(v) => void choose(v)}>
        <SelectTrigger size="sm" className="w-48" aria-label="Pagamento">
          <SelectValue placeholder="A definir" />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(PAYMENT_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Order detail (FR-023) ─────────────────────────────────────────────────────

/**
 * The order detail dialog. The Finance page opens it too, for orders that are not on today's
 * board; it then passes no `onCancel` and gets `onChanged` after a payment or invoice change.
 */
export function OrderDetailDialog({
  order,
  timezone,
  isAdmin,
  onClose,
  onCancel,
  onChanged,
}: {
  order: BoardOrder | null;
  timezone: string;
  isAdmin: boolean;
  onClose: () => void;
  onCancel?: (order: BoardOrder) => void;
  onChanged?: () => void;
}) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(false);
  // Bumped by the invoice panel after an issue, a cancel, or a final status (FR-128).
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => {
    setReloadKey((k) => k + 1);
    onChanged?.();
  }, [onChanged]);
  const orderId = order?.id ?? null;
  const orderStatus = order?.status ?? null;

  useEffect(() => {
    if (!orderId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void getOrderAction({ orderId }).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.ok) setDetail(result.data);
      else toast.error(result.error.message);
    });
    return () => {
      cancelled = true;
    };
    // Reload when the status changes under an open dialog, or the invoice panel asks.
  }, [orderId, orderStatus, reloadKey]);

  const view = detail && detail.id === orderId ? detail : null;

  return (
    <Dialog open={order !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono">{order?.code}</span>
            {order && <Badge variant="outline">{STATUS_LABELS[order.status]}</Badge>}
            {order?.fromAi && <span className="rounded bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">IA</span>}
          </DialogTitle>
          <DialogDescription>
            {order?.customerName} · {order?.customerPhone}
          </DialogDescription>
        </DialogHeader>
        {order && (
          <div className="space-y-4 text-sm">
            <ul className="space-y-1">
              {order.items.map((item, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>
                    {item.qty}x {item.name}
                    {item.sizeName ? ` (${item.sizeName})` : ""}
                    {item.notes ? <em className="block text-xs text-muted-foreground">{item.notes}</em> : null}
                  </span>
                  <span className="shrink-0 font-medium">{formatCents(item.lineTotalCents)}</span>
                </li>
              ))}
            </ul>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t pt-3 text-xs">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="text-right">{formatCents(order.subtotalCents)}</dd>
              <dt className="text-muted-foreground">Entrega</dt>
              <dd className="text-right">{formatCents(order.deliveryFeeCents)}</dd>
              <dt className="font-semibold">Total</dt>
              <dd className="text-right font-semibold">{formatCents(order.totalCents)}</dd>
              <dt className="text-muted-foreground">Pagamento</dt>
              <dd className="text-right">
                {paymentLabel(order.paymentMethod)}
                {order.changeForCents ? ` · troco para ${formatCents(order.changeForCents)}` : ""}
              </dd>
              <dt className="text-muted-foreground">Origem</dt>
              <dd className="text-right">{sourceLabel(order.source)}</dd>
              <dt className="text-muted-foreground">Endereço</dt>
              <dd className="text-right">{order.addressLine || "—"}</dd>
              {order.notes && (
                <>
                  <dt className="text-muted-foreground">Observação</dt>
                  <dd className="text-right">{order.notes}</dd>
                </>
              )}
              {order.cancelReason && (
                <>
                  <dt className="text-muted-foreground">Motivo do cancelamento</dt>
                  <dd className="text-right">{order.cancelReason}</dd>
                </>
              )}
            </dl>
            <div className="border-t pt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Histórico</p>
              {loading && !view ? (
                <p className="text-xs text-muted-foreground">Carregando...</p>
              ) : (
                <ol className="space-y-1 text-xs">
                  {view?.history.map((h, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span>
                        {h.fromStatus ? `${STATUS_LABELS[h.fromStatus]} → ` : "Criado como "}
                        <strong>{STATUS_LABELS[h.toStatus]}</strong>
                      </span>
                      <span className="text-muted-foreground">{formatDateTime(h.changedAt, timezone)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            {(view ? view.paymentMethod : order.paymentMethod) === null && (
              <PaymentMethodPicker orderId={order.id} onChanged={reload} />
            )}
            <PaymentSection
              orderId={order.id}
              status={view?.status ?? order.status}
              paidAt={view ? view.paidAt : order.paidAt}
              timezone={timezone}
              isAdmin={isAdmin}
              onChanged={reload}
            />
            <InvoicePanel order={order} detail={view} isAdmin={isAdmin} onChanged={reload} />
          </div>
        )}
        <DialogFooter>
          {order && onCancel && order.allowedStatuses.includes("cancelado") && (
            <Button variant="destructive" onClick={() => onCancel(order)}>
              Cancelar pedido
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function OrdersPage({
  restaurantId,
  timezone,
  orders,
  kpis,
  highlightId,
  isAdmin = false,
}: {
  restaurantId: string;
  timezone: string;
  orders: BoardOrder[];
  kpis: OrderKpis;
  highlightId: string | null;
  /** Only the admin cancels an invoice (FR-135, ADR-015); the server checks again. */
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  // Optimistic status per order id (FR-021). Dropped when the server catches up or the call fails.
  const [optimistic, setOptimistic] = useState<Record<string, OrderStatus>>({});
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [cancelTarget, setCancelTarget] = useState<BoardOrder | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(highlightId);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // FR-027: any change to this restaurant's orders refreshes the Server Component data.
  useRealtimeTable("orders", restaurantId, () => router.refresh());
  // FR-139: an invoice status change refreshes the card badges. The detail panel also polls.
  useRealtimeTable("order_invoices", restaurantId, () => router.refresh());

  // The new-order highlight fades after a few seconds.
  useEffect(() => {
    if (!highlightId) return;
    setHighlight(highlightId);
    const t = setTimeout(() => setHighlight(null), 6000);
    return () => clearTimeout(t);
  }, [highlightId]);

  const pendingRef = useRef<ReadonlySet<string>>(pending);
  pendingRef.current = pending;

  // Forget optimistic overrides the server data has caught up with.
  useEffect(() => {
    setOptimistic((prev) => {
      const next: Record<string, OrderStatus> = {};
      for (const [id, status] of Object.entries(prev)) {
        const server = orders.find((o) => o.id === id);
        if (server && server.status !== status && pendingRef.current.has(id)) next[id] = status;
      }
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [orders]);

  const orderList = useMemo(
    () => orders.map((o) => (optimistic[o.id] ? { ...o, status: optimistic[o.id] as OrderStatus } : o)),
    [orders, optimistic],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return orderList;
    return orderList.filter(
      (o) =>
        o.code.toLowerCase().includes(term) ||
        o.customerName.toLowerCase().includes(term) ||
        o.items.some((i) => i.name.toLowerCase().includes(term)),
    );
  }, [search, orderList]);

  const detailOrder = detailId ? (orderList.find((o) => o.id === detailId) ?? null) : null;

  function setPendingFlag(id: string, on: boolean) {
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function rollback(id: string) {
    setOptimistic((prev) => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
  }

  async function move(order: BoardOrder, to: OrderStatus, reason?: string) {
    setOptimistic((prev) => ({ ...prev, [order.id]: to }));
    setPendingFlag(order.id, true);
    const result =
      to === "cancelado"
        ? await cancelOrderAction({ orderId: order.id, reason })
        : await changeOrderStatusAction({ orderId: order.id, toStatus: to });
    setPendingFlag(order.id, false);
    if (!result.ok) {
      rollback(order.id);
      toast.error(result.error.message);
      return;
    }
    router.refresh();
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    const order = orderList.find((o) => o.id === String(active.id));
    const to = String(over.id) as OrderStatus;
    if (!order || to === order.status || !COLUMNS.some((c) => c.status === to)) return;
    // FR-021/FR-022: the server list of legal targets (core canTransition) decides; an illegal drop snaps back.
    if (!order.allowedStatuses.includes(to)) {
      toast.error(`Não é possível mover ${order.code} de ${STATUS_LABELS[order.status]} para ${STATUS_LABELS[to]}.`);
      return;
    }
    if (to === "cancelado") {
      setCancelTarget(order);
      return;
    }
    void move(order, to);
  }

  async function confirmCancel(order: BoardOrder, reason: string) {
    setCancelTarget(null);
    setDetailId(null);
    await move(order, "cancelado", reason);
  }

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
        {/* KPIs (FR-025): the restaurant's current day; revenue counts entregue only (ADR-015) */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 shrink-0">
          <KpiCard
            label="Faturamento entregue"
            value={formatCents(kpis.deliveredRevenueCents)}
            sub={`${kpis.deliveredCount} pedido(s) entregue(s)`}
            icon={DollarSign}
            color="bg-primary/10 text-primary"
          />
          <KpiCard
            label="Em andamento"
            value={String(kpis.inProgressCount)}
            sub="aguardando + confirmado + preparo"
            icon={Clock}
            color="bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-300"
          />
          <KpiCard
            label="Prontos"
            value={String(kpis.readyCount)}
            sub="aguardando retirada/entrega"
            icon={Package}
            color="bg-green-100 dark:bg-green-500/15 text-green-600 dark:text-green-300"
          />
          <KpiCard
            label="Saiu para entrega"
            value={String(kpis.outForDeliveryCount)}
            sub="a caminho do cliente"
            icon={Bike}
            color="bg-purple-100 dark:bg-purple-500/15 text-purple-600 dark:text-purple-300"
          />
        </div>

        {/* Search */}
        <div className="relative shrink-0 max-w-sm">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            placeholder="Buscar por pedido, cliente ou item..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Kanban board */}
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex gap-3 flex-1 overflow-hidden">
            {COLUMNS.map((col) => (
              <KanbanColumn
                key={col.status}
                col={col}
                orders={filtered.filter((o) => o.status === col.status)}
                activeId={activeId}
                pendingIds={pending}
                highlightId={highlight}
                timezone={timezone}
                onOpen={(o) => setDetailId(o.id)}
              />
            ))}
          </div>
        </DndContext>
      </div>

      <OrderDetailDialog
        order={detailOrder}
        timezone={timezone}
        isAdmin={isAdmin}
        onClose={() => setDetailId(null)}
        onCancel={(o) => setCancelTarget(o)}
      />
      <CancelDialog
        order={cancelTarget}
        busy={false}
        onConfirm={(o, reason) => void confirmCancel(o, reason)}
        onClose={() => setCancelTarget(null)}
      />
    </div>
  );
}
