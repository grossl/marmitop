import type { Metadata } from "next";

import { ReportsPage } from "@/components/reports-page";
import { requireScreen } from "@/lib/server/session";

export const metadata: Metadata = { title: "Relatórios — Marmitop" };

// Role gate on the server (FR-005): a screen the role cannot open is a 404.
export default async function RelatoriosRoute() {
  await requireScreen("relatorios");
  return (
    <div className="flex-1 overflow-hidden">
      <ReportsPage />
    </div>
  );
}
