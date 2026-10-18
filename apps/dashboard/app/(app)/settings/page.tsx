import { getAiSettings, getPlanAndUsage, getSettings, getUatisWebhookStatus, listWebhookDeliveries } from "@mt/http";
import type { Metadata } from "next";

import { SettingsPage } from "@/components/settings-page";
import { requireDeps } from "@/lib/server/deps";
import { requireScreen } from "@/lib/server/session";

export const metadata: Metadata = { title: "Configurações — Marmitop" };

// Role gate on the server (FR-005, FR-098): a screen the role cannot open is a 404.
// Secrets never reach this component: `getSettings` returns "configured" and last4 only (FR-094).
export default async function SettingsRoute() {
  const ctx = await requireScreen("settings");
  const deps = requireDeps();
  const [settings, plan, deliveries, ai] = await Promise.all([
    getSettings(deps, ctx, undefined),
    getPlanAndUsage(deps, ctx, undefined),
    listWebhookDeliveries(deps, ctx, undefined),
    getAiSettings(deps, ctx, undefined),
  ]);
  // FR-178: never throws on a gateway failure; null only when WhatsApp is not configured.
  const uatisWebhook = settings.integrations.whatsapp
    ? await getUatisWebhookStatus(deps, ctx, undefined).catch(() => null)
    : null;
  return (
    <div className="flex-1 overflow-hidden">
      <SettingsPage settings={settings} plan={plan} deliveries={deliveries} ai={ai} uatisWebhook={uatisWebhook} />
    </div>
  );
}
