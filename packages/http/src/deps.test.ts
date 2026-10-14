// covers ADR-017 (gateway choice from deployment config), ADR-012 (EnvelopeSecretBox from MT_KEK)
import { describe, expect, test } from "bun:test";
import { EnvelopeSecretBox, FakeGateway, FakeInvoiceGateway, FixedClock, systemClock } from "@mt/core";

import type { ServerConfig } from "./config";
import { UatisGateway } from "./adapters/uatis-gateway";
import { WebNfGateway } from "./adapters/web-nf-gateway";
import { createServiceDeps } from "./deps";

const config = (over: Partial<ServerConfig> = {}): ServerConfig => ({
  databaseUrl: "postgres://app_service:x@127.0.0.1:1/none",
  kek: new Uint8Array(32),
  kekVersion: 1,
  kekPrevious: undefined,
  uatisFake: true,
  webnfFake: true,
  env: "test",
  allowPrivateHosts: true,
  ...over,
});

const conn = { baseUrl: "http://localhost:1", apiKey: "k" };

describe("createServiceDeps", () => {
  test("fake flags select one shared fake per gateway", async () => {
    const deps = createServiceDeps(config());
    try {
      const a = deps.gateways.whatsapp(conn);
      expect(a).toBeInstanceOf(FakeGateway);
      expect(deps.gateways.whatsapp(conn)).toBe(a);
      expect(deps.gateways.invoices(conn)).toBeInstanceOf(FakeInvoiceGateway);
    } finally {
      await deps.db.end();
    }
  });

  test("without the fake flags the gateways are UatisGateway and WebNfGateway", async () => {
    const deps = createServiceDeps(config({ uatisFake: false, webnfFake: false }));
    try {
      expect(deps.gateways.whatsapp(conn)).toBeInstanceOf(UatisGateway);
      expect(deps.allowPrivateHosts).toBe(true);
      expect(deps.gateways.invoices(conn)).toBeInstanceOf(WebNfGateway);
    } finally {
      await deps.db.end();
    }
  });

  test("builds an EnvelopeSecretBox and the system clock unless overridden", async () => {
    const deps = createServiceDeps(config());
    const clock = new FixedClock("2026-01-01T00:00:00Z");
    const withClock = createServiceDeps(config(), { clock, db: deps.db });
    try {
      expect(deps.secretBox).toBeInstanceOf(EnvelopeSecretBox);
      expect(deps.clock).toBe(systemClock);
      expect(withClock.clock).toBe(clock);
    } finally {
      await deps.db.end();
    }
  });
});
