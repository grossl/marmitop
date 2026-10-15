// packages/http/src/deps.ts
//
// The dependency container every service takes as its first argument
// (04.architecture.md "Ports and adapters"). apps/dashboard, apps/api, and
// apps/worker each build one per process from `readServerConfig()`; tests
// build one around the test database (`@mt/http/testing`).

import {
  type Clock,
  EnvelopeSecretBox,
  FakeGateway,
  FakeInvoiceGateway,
  type InvoiceGateway,
  type SecretBox,
  systemClock,
  type WhatsAppGateway,
} from "@mt/core";
import { type ContextOptions, createDb, type Db } from "@mt/db";

import { createSafeFetch } from "./adapters/safe-fetch";
import { UatisGateway } from "./adapters/uatis-gateway";
import { WebNfGateway } from "./adapters/web-nf-gateway";
import type { ServerConfig } from "./config";

/** What a per-restaurant adapter needs. Read from `integrations_*` and `secrets` by the caller. */
export interface GatewayConnection {
  readonly baseUrl: string;
  readonly apiKey: string;
}

export interface GatewayFactory {
  whatsapp(conn: GatewayConnection): WhatsAppGateway;
  invoices(conn: GatewayConnection): InvoiceGateway;
}

export interface ServiceDeps {
  readonly db: Db;
  readonly secretBox: SecretBox;
  readonly clock: Clock;
  readonly gateways: GatewayFactory;
  /**
   * Passed to every `withRestaurantContext`. Always `{ role: "app_service" }`:
   * deployments already connect as `app_service`, and a `set local role` to
   * itself is a no-op; if `DATABASE_URL` ever names a more powerful role, RLS
   * still applies (defense in depth). Tests connect as the owner and rely on it.
   */
  readonly contextOptions: ContextOptions;
  readonly env: ServerConfig["env"];
  /** `MT_ALLOW_PRIVATE_HOSTS=1` (ADR-017 #5). URL checks and `safeFetch` read it. */
  readonly allowPrivateHosts: boolean;
  /** `MT_PUBLIC_URL` as configured (ADR-021, ADR-023). Picks push or pull in `enableUatisWebhook`. */
  readonly publicUrl: string | undefined;
}

export type ServiceDepsOverrides = Partial<Omit<ServiceDeps, "env" | "contextOptions" | "allowPrivateHosts">>;

function gatewaysFor(config: ServerConfig): GatewayFactory {
  // One fake per process, so a dev "simulate inbound" and the worker's sends
  // see the same recorded state.
  const fakeWhatsApp = config.uatisFake ? new FakeGateway() : undefined;
  const fakeInvoices = config.webnfFake ? new FakeInvoiceGateway() : undefined;
  // One guarded client per process: 10 s timeout, no redirects, SSRF guard (07.security.md).
  const safeFetch = createSafeFetch({ allowPrivateHosts: config.allowPrivateHosts });
  return {
    whatsapp(conn) {
      if (fakeWhatsApp) return fakeWhatsApp;
      return new UatisGateway({ baseUrl: conn.baseUrl, apiKey: conn.apiKey, fetch: safeFetch });
    },
    invoices(conn) {
      if (fakeInvoices) return fakeInvoices;
      return new WebNfGateway({ baseUrl: conn.baseUrl, apiKey: conn.apiKey, fetch: safeFetch });
    },
  };
}

export function createServiceDeps(config: ServerConfig, overrides: ServiceDepsOverrides = {}): ServiceDeps {
  return {
    db: overrides.db ?? createDb(config.databaseUrl),
    secretBox:
      overrides.secretBox ??
      new EnvelopeSecretBox({
        kek: config.kek,
        kekVersion: config.kekVersion,
        ...(config.kekPrevious ? { previous: { kek: config.kekPrevious, kekVersion: config.kekVersion - 1 } } : {}),
      }),
    clock: overrides.clock ?? systemClock,
    gateways: overrides.gateways ?? gatewaysFor(config),
    contextOptions: { role: "app_service" },
    env: config.env,
    allowPrivateHosts: config.allowPrivateHosts,
    publicUrl: "publicUrl" in overrides ? overrides.publicUrl : config.publicUrl,
  };
}
