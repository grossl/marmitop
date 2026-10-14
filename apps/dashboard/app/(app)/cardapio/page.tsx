import type { Metadata } from "next";

import { CardapioPage } from "@/components/cardapio-page";
import { requireScreen } from "@/lib/server/session";

export const metadata: Metadata = { title: "Cardápio — Marmitop" };

// Role gate on the server (FR-005): a screen the role cannot open is a 404.
export default async function CardapioRoute() {
  await requireScreen("cardapio");
  return (
    <div className="flex-1 overflow-hidden">
      <CardapioPage />
    </div>
  );
}
