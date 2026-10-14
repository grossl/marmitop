import { listMenuItems } from "@mt/http";
import type { Metadata } from "next";

import { MenuPage } from "@/components/menu-page";
import { requireDeps } from "@/lib/server/deps";
import { requireScreen } from "@/lib/server/session";

export const metadata: Metadata = { title: "Cardápio — Marmitop" };

// Role gate on the server (FR-005): a screen the role cannot open is a 404.
export default async function MenuRoute() {
  const ctx = await requireScreen("menu");
  const items = await listMenuItems(requireDeps(), ctx, {});
  return (
    <div className="flex-1 overflow-hidden">
      <MenuPage items={items} restaurantId={ctx.restaurantId} />
    </div>
  );
}
