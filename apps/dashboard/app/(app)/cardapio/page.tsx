import { listMenuItems } from "@mt/http";
import type { Metadata } from "next";

import { CardapioPage } from "@/components/cardapio-page";
import { requireDeps } from "@/lib/server/deps";
import { requireScreen } from "@/lib/server/session";

export const metadata: Metadata = { title: "Cardápio — Marmitop" };

// Role gate on the server (FR-005): a screen the role cannot open is a 404.
export default async function CardapioRoute() {
  const ctx = await requireScreen("cardapio");
  const items = await listMenuItems(requireDeps(), ctx, {});
  return (
    <div className="flex-1 overflow-hidden">
      <CardapioPage items={items} restaurantId={ctx.restaurantId} />
    </div>
  );
}
