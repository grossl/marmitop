"use client";

import { Clock, MapPin, ChefHat, CheckCircle, Package, Bike } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { type Order, type OrderStatus, contacts } from "@/lib/marmita-data";

const statusConfig: Record<
  OrderStatus,
  { label: string; icon: React.ElementType; className: string }
> = {
  novo: {
    label: "Novo",
    icon: Package,
    className: "bg-[--order-new] text-[--order-new-foreground]",
  },
  preparando: {
    label: "Preparando",
    icon: ChefHat,
    className: "bg-[--order-preparing] text-[--order-preparing-foreground]",
  },
  pronto: {
    label: "Pronto",
    icon: Bike,
    className: "bg-[--order-ready] text-[--order-ready-foreground]",
  },
  entregue: {
    label: "Entregue",
    icon: CheckCircle,
    className: "bg-[--order-delivered] text-[--order-delivered-foreground]",
  },
};

const nextStatus: Record<OrderStatus, OrderStatus | null> = {
  novo: "preparando",
  preparando: "pronto",
  pronto: "entregue",
  entregue: null,
};

const nextLabel: Record<OrderStatus, string | null> = {
  novo: "Iniciar preparo",
  preparando: "Marcar como pronto",
  pronto: "Confirmar entrega",
  entregue: null,
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
      {/* Top row */}
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

        <span
          className={cn(
            "flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full shrink-0",
            cfg.className
          )}
        >
          <StatusIcon className="w-3 h-3" />
          {cfg.label}
        </span>
      </div>

      <Separator className="mb-3" />

      {/* Items */}
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

      {/* Address */}
      <div className="flex items-start gap-1.5 mb-3">
        <MapPin className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">{order.address}</p>
      </div>

      {/* Total + action */}
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
            className={cn(
              "text-xs h-8 rounded-lg",
              next === "preparando" && "bg-primary hover:bg-primary/90 text-primary-foreground",
              next === "pronto" && "bg-amber-500 hover:bg-amber-600 text-white",
              next === "entregue" && "bg-green-600 hover:bg-green-700 text-white"
            )}
          >
            {nextLbl}
          </Button>
        )}
        {order.status === "entregue" && (
          <span className="text-xs text-muted-foreground italic">Concluído</span>
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
  const counts = {
    novo: orders.filter((o) => o.status === "novo").length,
    preparando: orders.filter((o) => o.status === "preparando").length,
    pronto: orders.filter((o) => o.status === "pronto").length,
    entregue: orders.filter((o) => o.status === "entregue").length,
  };

  const handleCardRef = (el: HTMLDivElement | null, id: string) => {
    cardRefs.current[id] = el;
  };

  return (
    <aside className="flex flex-col w-80 shrink-0 border-l border-border bg-muted/30">
      {/* Header */}
      <div className="px-4 py-4 border-b border-border bg-card shrink-0">
        <h2 className="text-sm font-bold text-foreground mb-3">Pedidos de Marmita</h2>
        <div className="grid grid-cols-4 gap-1.5">
          {(["novo", "preparando", "pronto", "entregue"] as OrderStatus[]).map((s) => {
            const cfg = statusConfig[s];
            return (
              <div
                key={s}
                className={cn(
                  "flex flex-col items-center rounded-lg py-1.5 px-1",
                  cfg.className
                )}
              >
                <span className="text-base font-bold leading-tight">{counts[s]}</span>
                <span className="text-[9px] font-medium text-center leading-tight">{cfg.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Orders scroll */}
      <ScrollArea className="flex-1">
        <div className="p-3 flex flex-col gap-3">
          {/* Novos */}
          {orders.filter((o) => o.status === "novo").length > 0 && (
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2 px-1">
                Novos pedidos
              </p>
              {orders
                .filter((o) => o.status === "novo")
                .map((o) => (
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
          )}

          {/* Em preparo */}
          {orders.filter((o) => o.status === "preparando").length > 0 && (
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2 px-1">
                Em preparo
              </p>
              {orders
                .filter((o) => o.status === "preparando")
                .map((o) => (
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
          )}

          {/* Prontos */}
          {orders.filter((o) => o.status === "pronto").length > 0 && (
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2 px-1">
                Prontos para entrega
              </p>
              {orders
                .filter((o) => o.status === "pronto")
                .map((o) => (
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
          )}

          {/* Entregues */}
          {orders.filter((o) => o.status === "entregue").length > 0 && (
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2 px-1">
                Entregues hoje
              </p>
              {orders
                .filter((o) => o.status === "entregue")
                .map((o) => (
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
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
