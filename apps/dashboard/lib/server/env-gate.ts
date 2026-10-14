import "server-only";

import { connection } from "next/server";

import { getDashboardDeps } from "@/lib/server/deps";

/**
 * The setup gate every signed-in route runs before it reads anything.
 * `await connection()` forces request-time evaluation: without it Next would
 * prerender the gate at build time, where DATABASE_URL and MT_KEK are absent,
 * and bake the setup notice into the output (web-nf env-gate.ts).
 */
export async function requireConfiguredEnv(): Promise<{ isConfigured: boolean; missing: readonly string[] }> {
  await connection();
  const deps = getDashboardDeps();
  return deps.configured ? { isConfigured: true, missing: [] } : { isConfigured: false, missing: deps.missing };
}
