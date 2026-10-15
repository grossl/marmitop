// covers FR-085, FR-086, FR-087, FR-088, FR-089, FR-090, FR-091, FR-094, FR-098, NFR-010, NFR-011
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AppError, FakeGateway, FakeInvoiceGateway, hashApiKey } from "@mt/core";
import type { Db } from "@mt/db";
import { createTestDb, type RestaurantFixture, seedRestaurant } from "@mt/db/test-harness";

import type { ServiceDeps } from "../../deps";
import { createTestServiceDeps, userCtx } from "../../testing";
import {
  connectWhatsApp,
  createApiKey,
  disconnectWhatsApp,
  revokeApiKey,
  rotateWebhookSecret,
  saveFiscalConfig,
  saveWebhookEndpoint,
  testFiscalConnection,
  testWhatsAppConnection,
} from "./integrations";
import { getSettings } from "./settings";

let db: Db;
let deps: ServiceDeps;
let whatsapp: FakeGateway;
let invoices: FakeInvoiceGateway;
let a: RestaurantFixture;
let b: RestaurantFixture;

const code = (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`);
const admin = () => userCtx(a.restaurantId, a.adminId, "admin");
const attendant = () => userCtx(a.restaurantId, a.attendantId, "attendant");

const PLAINTEXT_API = "uatis-api-key-1234567890abcdef";
const PLAINTEXT_HOOK = "uatis-webhook-secret-0987654321wxyz";

beforeAll(async () => {
  db = await createTestDb();
  whatsapp = new FakeGateway();
  invoices = new FakeInvoiceGateway();
  deps = createTestServiceDeps(db, { gateways: { whatsapp: () => whatsapp, invoices: () => invoices } });
  a = await seedRestaurant(db, "integ-a");
  b = await seedRestaurant(db, "integ-b");
});

afterAll(async () => {
  await db.end();
});

async function auditFor(f: RestaurantFixture, action: string) {
  return db<{ context: Record<string, unknown>; actor_id: string | null }[]>`
    select context, actor_id from public.audit_logs where restaurant_id = ${f.restaurantId} and action = ${action}`;
}

describe("connectWhatsApp", () => {
  const input = {
    baseUrl: "https://uatis.example.test/",
    apiKey: PLAINTEXT_API,
    webhookSecret: PLAINTEXT_HOOK,
    phoneNumberId: "pn-new",
  };

  test("seals both secrets, tests the connection, and returns no secret", async () => {
    const result = await connectWhatsApp(deps, admin(), input);
    expect(result).toEqual({ status: "connected", lastError: null });
    expect(JSON.stringify(result)).not.toContain(PLAINTEXT_API);
    expect(whatsapp.calls.some((c) => c.method === "testConnection")).toBe(true);

    const [integ] = await db<{ base_url: string; status: string; api_key_secret_id: string }[]>`
      select base_url, status, api_key_secret_id from public.integrations_whatsapp where restaurant_id = ${a.restaurantId}`;
    expect(integ).toMatchObject({ base_url: "https://uatis.example.test", status: "connected" });
    const [secret] = await db<{ ciphertext: Uint8Array; last4: string; kind: string }[]>`
      select ciphertext, last4, kind from public.secrets where id = ${integ?.api_key_secret_id}`;
    expect(secret?.kind).toBe("uatis_api_key");
    expect(secret?.last4).toBe(PLAINTEXT_API.slice(-4));
    // Old fixture secrets were replaced, not kept.
    const old = await db`select 1 from public.secrets where id = ${a.secretIds.uatisKey}`;
    expect(old).toHaveLength(0);
  });

  test("audit rows carry kind and last4 only", async () => {
    const rows = await auditFor(a, "secret.set");
    const mine = rows.filter((r) => r.context.kind === "uatis_api_key");
    expect(mine.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(Object.keys(r.context).sort()).toEqual(["kind", "last4"]);
      expect(JSON.stringify(r.context)).not.toContain(PLAINTEXT_API);
      expect(JSON.stringify(r.context)).not.toContain(PLAINTEXT_HOOK);
      expect(r.actor_id).toBe(a.adminId);
    }
  });

  test("getSettings shows configured and last4 only", async () => {
    const s = await getSettings(deps, admin(), undefined);
    expect(s.integrations.whatsapp?.apiKey).toEqual({ configured: true, last4: PLAINTEXT_API.slice(-4) });
    expect(JSON.stringify(s)).not.toContain(PLAINTEXT_API);
    expect(JSON.stringify(s)).not.toContain(PLAINTEXT_HOOK);
  });

  test("editing without secrets keeps the stored ones", async () => {
    await connectWhatsApp(deps, admin(), { baseUrl: "https://uatis.example.test", phoneNumberId: "pn-edit" });
    const s = await getSettings(deps, admin(), undefined);
    expect(s.integrations.whatsapp).toMatchObject({ phoneNumberId: "pn-edit", status: "connected" });
    expect(s.integrations.whatsapp?.apiKey.last4).toBe(PLAINTEXT_API.slice(-4));
  });

  test("a failed test stores status error with a short message", async () => {
    whatsapp.setConnection({ ok: false, error: "401 unauthorized" });
    const result = await testWhatsAppConnection(deps, admin(), undefined);
    expect(result).toEqual({ status: "error", lastError: "401 unauthorized" });
    whatsapp.setConnection({ ok: true });
    expect(await testWhatsAppConnection(deps, admin(), undefined)).toEqual({ status: "connected", lastError: null });
  });

  test("a gateway that throws becomes status error and never leaks the exception", async () => {
    const throwing = createTestServiceDeps(db, {
      gateways: {
        whatsapp: () => {
          throw new Error("secret-ish connection detail");
        },
        invoices: () => invoices,
      },
    });
    const result = await testWhatsAppConnection(throwing, admin(), undefined);
    expect(result.status).toBe("error");
    expect(result.lastError).not.toContain("secret-ish");
  });

  test("a first connection without secrets, a bad URL, and a private host in production are refused", async () => {
    await db`delete from public.integrations_whatsapp where restaurant_id = ${b.restaurantId}`;
    const e2 = await connectWhatsApp(deps, userCtx(b.restaurantId, b.adminId, "admin"), {
      baseUrl: "https://uatis.example.test",
      phoneNumberId: "x",
    }).catch((e) => e);
    expect(code(e2)).toBe("validation_failed");
    // FR-085 (ADR-021, ADR-023): only the API key is required; "Ativar webhook" stores the webhook secret.
    expect((e2 as AppError).details?.map((d) => d.path)).toEqual(["apiKey"]);

    const e3 = await connectWhatsApp(deps, admin(), { ...input, baseUrl: "ftp://x" }).catch((e) => e);
    expect(code(e3)).toBe("validation_failed");
    const prod = { ...deps, env: "production" as const, allowPrivateHosts: false };
    const e4 = await connectWhatsApp(prod, admin(), { ...input, baseUrl: "http://169.254.169.254" }).catch((e) => e);
    expect(code(e4)).toBe("validation_failed");
  });

  test("an attendant is refused", async () => {
    expect(code(await connectWhatsApp(deps, attendant(), input).catch((e) => e))).toBe("forbidden");
    expect(code(await testWhatsAppConnection(deps, attendant(), undefined).catch((e) => e))).toBe("forbidden");
    expect(code(await disconnectWhatsApp(deps, attendant(), undefined).catch((e) => e))).toBe("forbidden");
  });

  test("disconnect removes the integration and its secrets", async () => {
    const result = await disconnectWhatsApp(deps, admin(), undefined);
    expect(result).toEqual({ disconnected: true });
    const left = await db`select 1 from public.integrations_whatsapp where restaurant_id = ${a.restaurantId}`;
    expect(left).toHaveLength(0);
    const secrets =
      await db`select 1 from public.secrets where restaurant_id = ${a.restaurantId} and kind like 'uatis_%'`;
    expect(secrets).toHaveLength(0);
    expect(code(await testWhatsAppConnection(deps, admin(), undefined).catch((e) => e))).toBe(
      "whatsapp_not_configured",
    );
  });

  test("restaurant B's secrets were never touched", async () => {
    const rows = await db`select 1 from public.secrets where id = ${b.secretIds.uatisKey}`;
    expect(rows).toHaveLength(1);
  });
});

describe("saveFiscalConfig", () => {
  const input = {
    baseUrl: "https://webnf.example.test",
    apiKey: "webnf-api-key-abcdefghijklmnop",
    webhookSecret: "webnf-webhook-secret-qrstuvwxyz",
    environment: "homologacao",
    nfceSerie: 2,
    nfeSerie: 3,
    defaults: { ncm: "21069090", cfop: "5102", csosn: "102", pisCst: "49", cofinsCst: "49" },
    deliveryFeeMode: "none",
  };

  test("saves, seals the secrets, and tests the connection right after the save", async () => {
    const before = invoices.calls.filter((c) => c.method === "testConnection").length;
    const saved = await saveFiscalConfig(deps, admin(), input);
    // The automatic test runs after the commit, so issuing is not blocked on a manual click (V1).
    expect(saved).toEqual({ status: "connected", lastError: null });
    expect(invoices.calls.filter((c) => c.method === "testConnection").length).toBe(before + 1);
    expect(JSON.stringify(saved)).not.toContain(input.apiKey);
    const s = await getSettings(deps, admin(), undefined);
    expect(s.integrations.fiscal).toMatchObject({
      environment: "homologacao",
      nfceSerie: 2,
      deliveryFeeMode: "none",
      defaults: { ncm: "21069090", csosn: "102" },
      apiKey: { configured: true, last4: input.apiKey.slice(-4) },
    });
    expect(await testFiscalConnection(deps, admin(), undefined)).toEqual({ status: "connected", lastError: null });
    expect(invoices.calls.some((c) => c.method === "testConnection")).toBe(true);
  });

  test("editing without secrets keeps them; bad NCM is a field error", async () => {
    const { apiKey: _k, webhookSecret: _w, ...edit } = input;
    await saveFiscalConfig(deps, admin(), { ...edit, nfceSerie: 5 });
    const s = await getSettings(deps, admin(), undefined);
    expect(s.integrations.fiscal?.nfceSerie).toBe(5);
    expect(s.integrations.fiscal?.apiKey.configured).toBe(true);
    const bad = await saveFiscalConfig(deps, admin(), { ...input, defaults: { ...input.defaults, ncm: "12" } }).catch(
      (e) => e,
    );
    expect(code(bad)).toBe("validation_failed");
    expect((bad as AppError).details?.map((d) => d.path)).toContain("defaults.ncm");
  });

  test("an attendant is refused", async () => {
    expect(code(await saveFiscalConfig(deps, attendant(), input).catch((e) => e))).toBe("forbidden");
  });

  test("a refused key is saved and ends as error, not disconnected", async () => {
    invoices.setConnection({ ok: false, error: "A chave de API foi recusada pelo web-nf." });
    try {
      const saved = await saveFiscalConfig(deps, admin(), input);
      expect(saved.status).toBe("error");
      const [row] = await db<{ status: string }[]>`
        select status from public.integrations_fiscal where restaurant_id = ${a.restaurantId}`;
      expect(row?.status).toBe("error");
    } finally {
      invoices.setConnection({ ok: true });
    }
  });
});

describe("outbound webhook", () => {
  const hook = {
    url: "https://hooks.example.test/in",
    events: ["order.created", "order.created", "invoice.updated"],
    enabled: true,
  };

  test("creating returns the signing secret once; updating and listing do not", async () => {
    await db`delete from public.webhook_endpoints where restaurant_id = ${a.restaurantId}`;
    const created = await saveWebhookEndpoint(deps, admin(), hook);
    expect(created.secret).toMatch(/^[0-9A-Za-z]{43}$/);
    const s1 = await getSettings(deps, admin(), undefined);
    expect(s1.integrations.webhook).toMatchObject({ url: hook.url, events: ["order.created", "invoice.updated"] });
    expect(JSON.stringify(s1)).not.toContain(created.secret as string);

    const updated = await saveWebhookEndpoint(deps, admin(), { ...hook, enabled: false });
    expect(updated.secret).toBeNull();
  });

  test("rotating returns a new secret once, replaces the old row, and audits kind and last4", async () => {
    const before = await db<{ id: string }[]>`
      select id from public.secrets where restaurant_id = ${a.restaurantId} and kind = 'outbound_webhook_secret'`;
    const rotated = await rotateWebhookSecret(deps, admin(), undefined);
    expect(rotated.secret).toMatch(/^[0-9A-Za-z]{43}$/);
    const after = await db<{ id: string }[]>`
      select id from public.secrets where restaurant_id = ${a.restaurantId} and kind = 'outbound_webhook_secret'`;
    expect(after).toHaveLength(1);
    expect(after[0]?.id).not.toBe(before[0]?.id);
    const audits = await auditFor(a, "secret.set");
    expect(JSON.stringify(audits)).not.toContain(rotated.secret);
  });

  test("an unsafe URL, an unknown event, and an attendant are refused", async () => {
    const prod = { ...deps, env: "production" as const, allowPrivateHosts: false };
    expect(code(await saveWebhookEndpoint(prod, admin(), { ...hook, url: "http://localhost/x" }).catch((e) => e))).toBe(
      "validation_failed",
    );
    expect(code(await saveWebhookEndpoint(deps, admin(), { ...hook, events: ["nope"] }).catch((e) => e))).toBe(
      "validation_failed",
    );
    expect(code(await saveWebhookEndpoint(deps, attendant(), hook).catch((e) => e))).toBe("forbidden");
    expect(code(await rotateWebhookSecret(deps, attendant(), undefined).catch((e) => e))).toBe("forbidden");
  });

  test("rotating without an endpoint is not_found", async () => {
    await db`delete from public.webhook_endpoints where restaurant_id = ${b.restaurantId}`;
    expect(
      code(await rotateWebhookSecret(deps, userCtx(b.restaurantId, b.adminId, "admin"), undefined).catch((e) => e)),
    ).toBe("not_found");
  });
});

describe("API keys", () => {
  test("create returns the full key once; only its hash and prefix are stored", async () => {
    const created = await createApiKey(deps, admin(), { name: "ERP", environment: "live" });
    expect(created.key).toMatch(/^mtk_live_[0-9A-Za-z]{32}$/);
    expect(created.prefix).toBe(created.key.slice(0, "mtk_live_".length + 8));
    const [row] = await db<{ hash: string; prefix: string; created_by: string }[]>`
      select hash, prefix, created_by from public.api_keys where id = ${created.id}`;
    expect(row?.hash).toBe(hashApiKey(created.key));
    expect(row?.created_by).toBe(a.adminId);

    const s = await getSettings(deps, admin(), undefined);
    const listed = s.integrations.apiKeys.find((k) => k.id === created.id);
    expect(listed).toMatchObject({
      name: "ERP",
      prefix: created.prefix,
      environment: "live",
      revokedAt: null,
      lastUsedAt: null,
    });
    expect(JSON.stringify(s)).not.toContain(created.key);

    const audits = await auditFor(a, "api_key.create");
    expect(JSON.stringify(audits)).not.toContain(created.key);
    expect(audits.some((r) => r.context.last4 === created.key.slice(-4))).toBe(true);
  });

  test("revoke sets revoked_at, audits, and a second revoke is not_found", async () => {
    const created = await createApiKey(deps, admin(), { name: "Temp", environment: "test" });
    await revokeApiKey(deps, admin(), { id: created.id });
    const [row] = await db<
      { revoked_at: Date | null }[]
    >`select revoked_at from public.api_keys where id = ${created.id}`;
    expect(row?.revoked_at).not.toBeNull();
    expect((await auditFor(a, "api_key.revoke")).length).toBeGreaterThan(0);
    expect(code(await revokeApiKey(deps, admin(), { id: created.id }).catch((e) => e))).toBe("not_found");
  });

  test("another restaurant's key cannot be revoked", async () => {
    const e = await revokeApiKey(deps, admin(), { id: b.apiKeyId }).catch((x) => x);
    expect(code(e)).toBe("not_found");
    const [row] = await db<
      { revoked_at: Date | null }[]
    >`select revoked_at from public.api_keys where id = ${b.apiKeyId}`;
    expect(row?.revoked_at).toBeNull();
  });

  test("invalid input and an attendant are refused", async () => {
    expect(code(await createApiKey(deps, admin(), { name: " ", environment: "prod" }).catch((e) => e))).toBe(
      "validation_failed",
    );
    expect(code(await createApiKey(deps, attendant(), { name: "x", environment: "test" }).catch((e) => e))).toBe(
      "forbidden",
    );
    expect(code(await revokeApiKey(deps, attendant(), { id: a.apiKeyId }).catch((e) => e))).toBe("forbidden");
  });
});
