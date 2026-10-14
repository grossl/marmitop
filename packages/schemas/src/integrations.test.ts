// covers FR-085, FR-087, FR-089, FR-090, FR-094, NFR-014
import { describe, expect, test } from "bun:test";
import {
  createApiKeySchema,
  makeConnectWhatsAppSchema,
  makeSaveFiscalConfigSchema,
  makeSaveWebhookEndpointSchema,
  makeUpdateFiscalConfigSchema,
  makeUpdateWhatsAppSchema,
  revokeApiKeySchema,
  WEBHOOK_EVENTS,
} from "./integrations";

const prod = { allowPrivateHosts: false };
const dev = { allowPrivateHosts: true };

describe("connectWhatsApp (FR-085)", () => {
  const body = {
    baseUrl: "https://uatis.example.com",
    apiKey: "obk_test_abc",
    webhookSecret: "whsec_1",
    phoneNumberId: "1234567890",
  };
  test("accepts the connection fields", () => {
    expect(makeConnectWhatsAppSchema(prod).safeParse(body).success).toBe(true);
  });
  test("all four fields are required", () => {
    for (const key of Object.keys(body)) {
      const { [key]: _omit, ...rest } = body as Record<string, string>;
      expect(makeConnectWhatsAppSchema(prod).safeParse(rest).success).toBe(false);
    }
  });
  test("production blocks http, user info, and private hosts (NFR-014)", () => {
    const s = makeConnectWhatsAppSchema(prod);
    for (const baseUrl of [
      "http://uatis.example.com",
      "https://user:pw@uatis.example.com",
      "https://127.0.0.1",
      "https://169.254.169.254",
      "https://localhost:8080",
      "nope",
    ]) {
      expect(s.safeParse({ ...body, baseUrl }).success).toBe(false);
    }
  });
  test("development allows localhost over http (MT_ALLOW_PRIVATE_HOSTS=1)", () => {
    expect(makeConnectWhatsAppSchema(dev).safeParse({ ...body, baseUrl: "http://localhost:8787" }).success).toBe(true);
  });
  test("the base URL is normalized: trailing slash removed", () => {
    expect(makeConnectWhatsAppSchema(prod).parse({ ...body, baseUrl: "https://uatis.example.com/" }).baseUrl).toBe(
      "https://uatis.example.com",
    );
  });
  test("on edit, the secrets may be omitted to keep the stored ones", () => {
    const { apiKey, webhookSecret, ...rest } = body;
    expect(makeUpdateWhatsAppSchema(prod).safeParse(rest).success).toBe(true);
  });
});

describe("saveWebhookEndpoint (FR-087)", () => {
  test("https url and events from the list in FR-146", () => {
    const s = makeSaveWebhookEndpointSchema(prod);
    expect(
      s.safeParse({ url: "https://hooks.example.com/mt", events: ["order.created", "invoice.updated"], enabled: true })
        .success,
    ).toBe(true);
    expect(s.safeParse({ url: "http://hooks.example.com/mt", events: ["order.created"], enabled: true }).success).toBe(
      false,
    );
    expect(s.safeParse({ url: "https://hooks.example.com/mt", events: ["order.deleted"], enabled: true }).success).toBe(
      false,
    );
    expect([...WEBHOOK_EVENTS]).toEqual([
      "order.created",
      "order.status_changed",
      "message.received",
      "invoice.updated",
    ]);
  });
  test("events are de-duplicated", () => {
    const r = makeSaveWebhookEndpointSchema(prod).parse({
      url: "https://h.example.com",
      events: ["order.created", "order.created"],
      enabled: true,
    });
    expect(r.events).toEqual(["order.created"]);
  });
});

describe("API keys (FR-089)", () => {
  test("create takes a name and an environment", () => {
    expect(createApiKeySchema.safeParse({ name: "ERP", environment: "live" }).success).toBe(true);
    expect(createApiKeySchema.safeParse({ name: "ERP", environment: "staging" }).success).toBe(false);
    expect(createApiKeySchema.safeParse({ name: "", environment: "test" }).success).toBe(false);
  });
  test("revoke takes a uuid", () => {
    expect(revokeApiKeySchema.safeParse({ id: "3f6c1a0e-7a3b-4b1e-9c53-1f3f6d0f6a11" }).success).toBe(true);
    expect(revokeApiKeySchema.safeParse({ id: "x" }).success).toBe(false);
  });
});

describe("saveFiscalConfig (FR-090)", () => {
  const body = {
    baseUrl: "https://nf.example.com",
    apiKey: "nfk_test_abc",
    webhookSecret: "whsec_2",
    environment: "homologacao",
    nfceSerie: 1,
    nfeSerie: 1,
    defaults: { ncm: "21069090", cfop: "5101", csosn: "102", pisCst: "49", cofinsCst: "49" },
    deliveryFeeMode: "item",
  };
  test("accepts a full configuration", () => {
    expect(makeSaveFiscalConfigSchema(prod).safeParse(body).success).toBe(true);
  });
  test("every default is required before invoicing is allowed", () => {
    for (const key of ["ncm", "cfop", "csosn", "pisCst", "cofinsCst"] as const) {
      const { [key]: _omit, ...defaults } = body.defaults;
      const r = makeSaveFiscalConfigSchema(prod).safeParse({ ...body, defaults });
      expect(r.success).toBe(false);
    }
  });
  test("format of each code and the series range", () => {
    const s = makeSaveFiscalConfigSchema(prod);
    expect(s.safeParse({ ...body, defaults: { ...body.defaults, ncm: "2106" } }).success).toBe(false);
    expect(s.safeParse({ ...body, defaults: { ...body.defaults, cfop: "51" } }).success).toBe(false);
    expect(s.safeParse({ ...body, defaults: { ...body.defaults, csosn: "1022" } }).success).toBe(false);
    expect(s.safeParse({ ...body, defaults: { ...body.defaults, pisCst: "4" } }).success).toBe(false);
    expect(s.safeParse({ ...body, nfceSerie: 0 }).success).toBe(false);
    expect(s.safeParse({ ...body, nfeSerie: 1000 }).success).toBe(false);
    expect(s.safeParse({ ...body, environment: "sandbox" }).success).toBe(false);
    expect(s.safeParse({ ...body, deliveryFeeMode: "maybe" }).success).toBe(false);
  });
  test("the fiscal environment field decides homologacao or producao, not the key prefix", () => {
    expect(
      makeSaveFiscalConfigSchema(prod).safeParse({ ...body, apiKey: "nfk_live_abc", environment: "producao" }).success,
    ).toBe(true);
  });
  test("on edit, the secrets may be omitted to keep the stored ones", () => {
    const { apiKey, webhookSecret, ...rest } = body;
    expect(makeSaveFiscalConfigSchema(prod).safeParse(rest).success).toBe(false);
    expect(makeUpdateFiscalConfigSchema(prod).safeParse(rest).success).toBe(true);
  });
  test("delivery fee mode defaults to item", () => {
    const { deliveryFeeMode, ...rest } = body;
    expect(makeSaveFiscalConfigSchema(prod).parse(rest).deliveryFeeMode).toBe("item");
  });
});
