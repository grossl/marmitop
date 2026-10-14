import { getPlanAndUsage, getSettings } from "@mt/http";
import type { Metadata } from "next";

import { SettingsPage } from "@/components/settings-page";
import { requireDeps } from "@/lib/server/deps";
import { requireScreen } from "@/lib/server/session";

export const metadata: Metadata = { title: "Configurações — Marmitop" };

// Role gate on the server (FR-005, FR-098): a screen the role cannot open is a 404.
// Secrets never reach this component: `getSettings` returns "configured" and last4 only (FR-094).
export default async function ConfiguracoesRoute() {
  const ctx = await requireScreen("configuracoes");
  const deps = requireDeps();
  const [settings, plan] = await Promise.all([getSettings(deps, ctx, undefined), getPlanAndUsage(deps, ctx, undefined)]);
  return (
    <div className="flex-1 overflow-hidden">
      <SettingsPage settings={settings} plan={plan} />
    </div>
  );
}
