import type { Metadata } from "next";

import { SettingsPage } from "@/components/settings-page";
import { requireScreen } from "@/lib/server/session";

export const metadata: Metadata = { title: "Configurações — Marmitop" };

// Role gate on the server (FR-005): a screen the role cannot open is a 404.
export default async function ConfiguracoesRoute() {
  await requireScreen("configuracoes");
  return (
    <div className="flex-1 overflow-hidden">
      <SettingsPage />
    </div>
  );
}
