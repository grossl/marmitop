import type { Metadata } from "next";

import { StockPage } from "@/components/stock-page";
import { requireScreen } from "@/lib/server/session";

export const metadata: Metadata = { title: "Estoque — Marmitop" };

// Role gate on the server (FR-005): a screen the role cannot open is a 404.
export default async function EstoqueRoute() {
  await requireScreen("estoque");
  return (
    <div className="flex-1 overflow-hidden">
      <StockPage />
    </div>
  );
}
