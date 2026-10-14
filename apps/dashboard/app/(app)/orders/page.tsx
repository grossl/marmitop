import { getOrdersBoard } from "@mt/http";
import type { Metadata } from "next";

import { OrdersPage } from "@/components/orders-page";
import { requireDeps } from "@/lib/server/deps";
import { requireScreen } from "@/lib/server/session";

export const metadata: Metadata = { title: "Pedidos — Marmitop" };
export const dynamic = "force-dynamic";

// Role gate on the server (FR-005): a screen the role cannot open is a 404.
// The board and the KPIs load here; Realtime triggers router.refresh() (FR-027).
// `?new=<orderId>` highlights the card of an order just created (FR-030..FR-039).
export default async function OrdersRoute({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const ctx = await requireScreen("orders");
  const { new: newOrderId } = await searchParams;
  const board = await getOrdersBoard(requireDeps(), ctx, undefined);
  return (
    <div className="flex-1 overflow-hidden">
      <OrdersPage
        restaurantId={ctx.restaurantId}
        timezone={board.timezone}
        orders={[...board.orders]}
        kpis={board.kpis}
        highlightId={newOrderId ?? null}
        isAdmin={ctx.role === "admin"}
      />
    </div>
  );
}
