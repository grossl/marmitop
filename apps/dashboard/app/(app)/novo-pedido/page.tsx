import type { Metadata } from "next";

import { ManualOrderPage } from "@/components/manual-order-page";
import { requireScreen } from "@/lib/server/session";

export const metadata: Metadata = { title: "Novo pedido — Marmitop" };

// Role gate on the server (FR-005): a screen the role cannot open is a 404.
export default async function NovoPedidoRoute() {
  await requireScreen("novo-pedido");
  return (
    <div className="flex-1 overflow-hidden">
      <ManualOrderPage />
    </div>
  );
}
