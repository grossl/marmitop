import { listStockItems } from "@mt/http";
import type { Metadata } from "next";

import { StockPage } from "@/components/stock-page";
import { requireDeps } from "@/lib/server/deps";
import { requireScreen } from "@/lib/server/session";

export const metadata: Metadata = { title: "Estoque — Marmitop" };

// Role gate on the server (FR-005): a screen the role cannot open is a 404.
export default async function StockRoute() {
  const ctx = await requireScreen("stock");
  const stock = await listStockItems(requireDeps(), ctx, {});
  return (
    <div className="flex-1 overflow-hidden">
      <StockPage items={[...stock.items]} lowCount={stock.lowCount} totalValueCents={stock.totalValueCents} />
    </div>
  );
}
