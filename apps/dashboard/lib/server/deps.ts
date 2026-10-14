import "server-only";

import { createServiceDeps, readServerConfig, type ServiceDeps } from "@mt/http";

import { getPublicEnv } from "@/lib/env";

// The dashboard's service dependencies (ADR-004): one per process, cached on
// globalThis so Turbopack HMR does not leak a postgres.js pool per save.
// Lazy, and never throws: a missing variable yields `{ configured: false }`
// and the pages render the setup notice (web-nf ADR-013 pattern).

export type DashboardDeps =
  | { readonly configured: true; readonly deps: ServiceDeps }
  | { readonly configured: false; readonly missing: readonly string[] };

const KEY = Symbol.for("@mt/dashboard.serviceDeps");
type DepsGlobal = typeof globalThis & { [KEY]?: DashboardDeps };

export function getDashboardDeps(): DashboardDeps {
  const store = globalThis as DepsGlobal;
  const cached = store[KEY];
  if (cached) return cached;
  const config = readServerConfig(process.env);
  const publicMissing = getPublicEnv().missing;
  const resolved: DashboardDeps =
    config.ok && publicMissing.length === 0
      ? { configured: true, deps: createServiceDeps(config.config) }
      : { configured: false, missing: [...publicMissing, ...(config.ok ? [] : config.missing)] };
  // Cache only success, so fixing .env.local and reloading recovers in dev.
  if (resolved.configured) store[KEY] = resolved;
  return resolved;
}

/** The deps, or a throw that names the missing variables (never their values). */
export function requireDeps(): ServiceDeps {
  const d = getDashboardDeps();
  if (!d.configured) throw new Error(`Ambiente do servidor não configurado: ${d.missing.join(", ")}.`);
  return d.deps;
}
