// @mt/http/testing — service deps around the integration-test database.
// Tests only. The db is the owner connection from @mt/db/test-harness;
// `contextOptions` switches every service transaction to `app_service`, so
// tests walk the production RLS path (10.testing.md).

import { FakeSecretBox, FixedClock } from "@mt/core";
import type { Db } from "@mt/db";

import type { ServerConfig } from "../config";
import { createServiceDeps, type ServiceDeps, type ServiceDepsOverrides } from "../deps";
import type { UserContext } from "../context";

/** `config` overrides the test config, for example `{ env: "production" }` (ADR-041 tests). */
export function createTestServiceDeps(
  db: Db,
  overrides: ServiceDepsOverrides = {},
  config: Partial<ServerConfig> = {},
): ServiceDeps {
  return createServiceDeps(
    {
      databaseUrl: "postgres://unused",
      kek: new Uint8Array(32),
      kekVersion: 1,
      kekPrevious: undefined,
      uatisFake: true,
      webnfFake: true,
      env: "test",
      allowPrivateHosts: true,
      publicUrl: undefined,
      ...config,
    },
    { db, secretBox: new FakeSecretBox(), clock: new FixedClock("2026-10-13T15:00:00Z"), ...overrides },
  );
}

export function userCtx(restaurantId: string, userId: string, role: UserContext["role"]): UserContext {
  return { restaurantId, userId, role, actorType: "user" };
}

export {
  FakeUatisServer,
  type FakeUatisDelivery,
  type FakeUatisRow,
  type FakeUatisScript,
  type FakeUatisWebhook,
  uatisWebhookBody,
} from "./fake-uatis-server";
export { MemoryUatisInboundStore } from "./memory-uatis-inbound-store";
export { FakeWebNfServer, type FakeWebNfInvoice, type FakeWebNfScript } from "./fake-web-nf-server";
export { MemoryWebNfInboundStore } from "./memory-web-nf-inbound-store";
