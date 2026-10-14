import type { Metadata } from "next";

import { OrdersPage } from "@/components/orders-page";
import { requireScreen } from "@/lib/server/session";

export const metadata: Metadata = { title: "Pedidos — Marmitop" };

// Role gate on the server (FR-005): a screen the role cannot open is a 404.
export default async function PedidosRoute() {
  await requireScreen("pedidos");
  return (
    <div className="flex-1 overflow-hidden">
      <OrdersPage />
    </div>
  );
}
