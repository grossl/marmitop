// @mt/http/testing — service deps around the integration-test database.
// Tests only. The db is the owner connection from @mt/db/test-harness;
// `contextOptions` switches every service transaction to `app_service`, so
// tests walk the production RLS path (10.testing.md).

import { FakeSecretBox, FixedClock } from "@mt/core";
import type { Db } from "@mt/db";

import { createServiceDeps, type ServiceDeps, type ServiceDepsOverrides } from "../deps";
import type { UserContext } from "../context";

export function createTestServiceDeps(db: Db, overrides: ServiceDepsOverrides = {}): ServiceDeps {
  return createServiceDeps(
    {
      databaseUrl: "postgres://unused",
      kek: new Uint8Array(32),
      kekVersion: 1,
      kekPrevious: undefined,
      uatisFake: true,
      webnfFake: true,
      env: "test",
    },
    { db, secretBox: new FakeSecretBox(), clock: new FixedClock("2026-10-13T15:00:00Z"), ...overrides },
  );
}

export function userCtx(restaurantId: string, userId: string, role: UserContext["role"]): UserContext {
  return { restaurantId, userId, role, actorType: "user" };
}
