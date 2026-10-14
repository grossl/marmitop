import type { Metadata } from "next";
import { UtensilsCrossed } from "lucide-react";
import { connection } from "next/server";

import { LoginForm } from "@/components/login-form";
import { SetupNotice } from "@/components/setup-notice";
import { getPublicEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Entrar — Marmitop" };

// FR-001. The proxy sends signed-in users to /mensagens.
export default async function LoginPage() {
  // Request time, so a build without the public env does not bake in the notice.
  await connection();
  const env = getPublicEnv();
  if (!env.isSupabaseConfigured) return <SetupNotice missing={env.missing} />;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary">
            <UtensilsCrossed className="h-6 w-6 text-primary-foreground" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Marmitop</h1>
            <p className="text-sm text-muted-foreground">Entre para gerenciar seu restaurante</p>
          </div>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
