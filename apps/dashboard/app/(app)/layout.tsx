import { listMemberships } from "@mt/http";
import { Toaster } from "@mt/ui/components/sonner";

import { NavSidebar } from "@/components/nav-sidebar";
import { NoRestaurantNotice } from "@/components/no-restaurant-notice";
import { SetupNotice } from "@/components/setup-notice";
import { requireDeps } from "@/lib/server/deps";
import { requireConfiguredEnv } from "@/lib/server/env-gate";
import { requireMember } from "@/lib/server/session";

// Every signed-in screen (ADR-004). Order: env gate, session (redirects to
// /login), membership. The nav receives the role resolved on the server.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const env = await requireConfiguredEnv();
  if (!env.isConfigured) return <SetupNotice missing={env.missing} />;

  const { user, ctx } = await requireMember();
  if (!ctx) return <NoRestaurantNotice email={user.email} />;

  const memberships = await listMemberships(requireDeps(), user.id);
  const restaurantName = memberships.find((m) => m.restaurantId === ctx.restaurantId)?.restaurantName ?? "Marmitop";

  return (
    <main className="flex h-screen overflow-hidden bg-background">
      <NavSidebar role={ctx.role} restaurantName={restaurantName} userEmail={user.email} />
      {children}
      <Toaster richColors position="top-right" />
    </main>
  );
}
