"use client";

import { Clock, MapPin, CheckCircle, Package, Bike, AlertCircle, UtensilsCrossed, CheckCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { type Order, type OrderStatus, contacts, statusLabels } from "@/lib/marmita-data";

const statusConfig: Record<
  OrderStatus,
  { icon: React.ElementType; className: string }
> = {
  aguardando: { icon: AlertCircle,      className: "bg-yellow-100 text-yellow-700" },
  confirmado: { icon: CheckCircle,      className: "bg-blue-100 text-blue-700" },
  preparando: { icon: UtensilsCrossed,  className: "bg-orange-100 text-orange-700" },
  pronto:     { icon: Package,          className: "bg-green-100 text-green-700" },
  saiu:       { icon: Bike,             className: "bg-purple-100 text-purple-700" },
  entregue:   { icon: CheckCheck,       className: "bg-slate-100 text-slate-600" },
};

const nextStatus: Partial<Record<OrderStatus, OrderStatus>> = {
  aguardando: "confirmado",
  confirmado:  "preparando",
  preparando:  "pronto",
  pronto:      "saiu",
  saiu:        "entregue",
};

const nextLabel: Partial<Record<OrderStatus, string>> = {
  aguardando: "Confirmar pedido",
  confirmado:  "Iniciar preparo",
  preparando:  "Marcar como pronto",
  pronto:      "Saiu para entrega",
  saiu:        "Marcar como entregue",
};

interface OrderCardProps {
  order: Order;
  isHighlighted: boolean;
  onStatusChange: (id: string, status: OrderStatus) => void;
  onCardRef: (el: HTMLDivElement | null, id: string) => void;
}

function OrderCard({ order, isHighlighted, onStatusChange, onCardRef }: OrderCardProps) {
  const contact = contacts.find((c) => c.id === order.contactId);
  const cfg = statusConfig[order.status];
  const StatusIcon = cfg.icon;
  const next = nextStatus[order.status];
  const nextLbl = nextLabel[order.status];

  return (
    <div
      ref={(el) => onCardRef(el, order.id)}
      className={cn(
        "rounded-xl border bg-card p-4 transition-all duration-300",
        isHighlighted
          ? "border-primary ring-2 ring-primary/30 shadow-md"
          : "border-border shadow-sm"
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-xs font-semibold text-muted-foreground">#{order.id}</span>
            {order.deliveryTime && (
              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                <Clock className="w-3 h-3" />
                {order.deliveryTime}
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-foreground">{contact?.name}</p>
          <p className="text-xs text-muted-foreground">{contact?.phone}</p>
        </div>
        <span className={cn("flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full shrink-0", cfg.className)}>
          <StatusIcon className="w-3 h-3" />
          {statusLabels[order.status]}
        </span>
      </div>

      <Separator className="mb-3" />

      <div className="flex flex-col gap-1.5 mb-3">
        {order.items.map((item, i) => (
          <div key={i} className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground leading-snug">
                <span className="font-semibold text-primary">{item.qty}x</span> {item.name}
              </p>
              {item.obs && (
                <p className="text-[11px] text-muted-foreground mt-0.5 italic">{item.obs}</p>
              )}
            </div>
            <span className="text-sm font-medium text-foreground shrink-0">
              R$ {(item.price * item.qty).toFixed(2).replace(".", ",")}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-1.5 mb-3">
        <MapPin className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">{order.address}</p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Total</span>
          <p className="text-base font-bold text-foreground">
            R$ {order.total.toFixed(2).replace(".", ",")}
          </p>
        </div>
        {next && nextLbl && (
          <Button
            size="sm"
            onClick={() => onStatusChange(order.id, next)}
            className="text-xs h-8 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {nextLbl}
          </Button>
        )}
        {order.status === "entregue" && (
          <span className="text-xs text-muted-foreground italic">Finalizado</span>
        )}
      </div>
    </div>
  );
}

interface OrdersPanelProps {
  orders: Order[];
  highlightedOrderId?: string;
  onStatusChange: (id: string, status: OrderStatus) => void;
  cardRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
}

export function OrdersPanel({
  orders,
  highlightedOrderId,
  onStatusChange,
  cardRefs,
}: OrdersPanelProps) {
  const handleCardRef = (el: HTMLDivElement | null, id: string) => {
    cardRefs.current[id] = el;
  };

  const sections: { key: OrderStatus; label: string }[] = [
    { key: "aguardando", label: "Aguardando confirmação" },
    { key: "confirmado",  label: "Confirmados" },
    { key: "preparando",  label: "Em preparo" },
    { key: "pronto",      label: "Prontos para entrega" },
        { key: "saiu",        label: "Saiu para entrega" },
        { key: "entregue",    label: "Entregues" },
  ];

  return (
    <aside className="flex flex-col w-80 shrink-0 border-l border-border bg-muted/30">
      <div className="px-4 py-4 border-b border-border bg-card shrink-0">
        <h2 className="text-sm font-bold text-foreground">Pedidos de Marmita</h2>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-3 flex flex-col gap-3">
          {sections.map(({ key, label }) => {
            const sectionOrders = orders.filter((o) => o.status === key);
            if (sectionOrders.length === 0) return null;
            return (
              <section key={key}>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2 px-1">
                  {label}
                </p>
                {sectionOrders.map((o) => (
                  <div key={o.id} className="mb-2">
                    <OrderCard
                      order={o}
                      isHighlighted={highlightedOrderId === o.id}
                      onStatusChange={onStatusChange}
                      onCardRef={handleCardRef}
                    />
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      </ScrollArea>
    </aside>
  );
}
