"use client";

import type { CustomerOrderSummary } from "@mt/http";
import { Badge } from "@mt/ui/components/badge";
import { ScrollArea } from "@mt/ui/components/scroll-area";
import { cn } from "@mt/ui/lib/utils";
import Link from "next/link";

import { formatBRL, formatDate, ORDER_STATUS_LABELS, ORDER_STATUS_STYLES } from "@/components/messaging-format";

// The open conversation customer's orders, newest first (FR-018). Moving an
// order to its next status stays on /pedidos until the orders agent exposes
// changeOrderStatus here.
export function CustomerOrdersPanel({
  orders,
  highlightedOrderId,
}: {
  orders: readonly CustomerOrderSummary[];
  highlightedOrderId?: string | null;
}) {
  return (
    <aside className="hidden lg:flex w-72 shrink-0 flex-col border-l border-border bg-card">
      <div className="px-4 py-3 border-b border-border">
        <p className="text-sm font-semibold text-foreground">Pedidos do cliente</p>
        <p className="text-xs text-muted-foreground">{orders.length} no histórico</p>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-3">
          {orders.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">Nenhum pedido ainda.</p>}
          {orders.map((order) => (
            <div
              key={order.id}
              className={cn(
                "space-y-1.5 rounded-lg border p-3 text-sm transition-colors",
                highlightedOrderId === order.id ? "border-primary bg-primary/5" : "border-border",
              )}
            >
              <div className="flex items-center justify-between">
                <Link href="/pedidos" className="font-mono text-xs font-medium text-primary hover:underline">
                  {order.code}
                </Link>
                <Badge variant="outline" className={cn("border text-[10px]", ORDER_STATUS_STYLES[order.status])}>
                  {ORDER_STATUS_LABELS[order.status] ?? order.status}
                </Badge>
              </div>
              <ul className="text-xs text-foreground">
                {order.items.map((item, i) => (
                  <li key={i}>
                    {item.qty}x {item.name}
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{formatDate(order.createdAt)}</span>
                <span className="font-semibold text-foreground">{formatBRL(order.totalCents)}</span>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </aside>
  );
}
