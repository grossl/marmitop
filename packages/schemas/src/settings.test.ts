// covers FR-080, FR-081, FR-082, FR-083, FR-084, FR-095, FR-096, FR-200, FR-240, ADR-028
import { describe, expect, test } from "bun:test";
import {
  AUTOMATIC_MESSAGE_KINDS,
  saveAutomaticMessageSchema,
  saveBusinessHoursSchema,
  saveOrderPreferencesSchema,
  saveProfileSchema,
} from "./settings";

describe("saveProfileSchema (FR-080)", () => {
  test("name is required; cidade/uf/codigoMunicipio feed address defaults", () => {
    const p = saveProfileSchema.parse({
      name: "Marmitop Centro",
      phone: "(11) 3333-4444",
      cidade: "São Paulo",
      uf: "sp",
      codigoMunicipio: "3550308",
    });
    expect(p).toMatchObject({ name: "Marmitop Centro", uf: "SP", codigoMunicipio: "3550308" });
    expect(saveProfileSchema.safeParse({ name: "" }).success).toBe(false);
    expect(saveProfileSchema.safeParse({ name: "x".repeat(121) }).success).toBe(false);
  });
  test("uf and IBGE code are validated", () => {
    expect(saveProfileSchema.safeParse({ name: "X", uf: "ZZ" }).success).toBe(false);
    expect(saveProfileSchema.safeParse({ name: "X", codigoMunicipio: "123" }).success).toBe(false);
  });
  test("email must be valid when present", () => {
    expect(saveProfileSchema.safeParse({ name: "X", email: "no" }).success).toBe(false);
    expect(saveProfileSchema.parse({ name: "X", email: "" }).email).toBeNull();
  });
});

describe("saveOrderPreferencesSchema (FR-081, FR-082, FR-096, FR-240)", () => {
  const prefs = {
    autoAccept: false,
    pickupEnabled: true,
    showDeliveryEstimate: true,
    deliveryFeeCents: 600,
    deliveryEstimateMinutes: 45,
  };
  test("accepts valid preferences with the default timezone and menu auto-confirm off", () => {
    expect(saveOrderPreferencesSchema.parse(prefs)).toEqual({
      ...prefs,
      timezone: "America/Sao_Paulo",
      autoConfirmMenuOrders: false,
    });
    expect(saveOrderPreferencesSchema.parse({ ...prefs, autoConfirmMenuOrders: true }).autoConfirmMenuOrders).toBe(true);
  });
  test("fee is non-negative integer cents; estimate is 5..240 minutes", () => {
    expect(saveOrderPreferencesSchema.safeParse({ ...prefs, deliveryFeeCents: -1 }).success).toBe(false);
    expect(saveOrderPreferencesSchema.safeParse({ ...prefs, deliveryFeeCents: 5.5 }).success).toBe(false);
    expect(saveOrderPreferencesSchema.safeParse({ ...prefs, deliveryEstimateMinutes: 4 }).success).toBe(false);
    expect(saveOrderPreferencesSchema.safeParse({ ...prefs, deliveryEstimateMinutes: 241 }).success).toBe(false);
  });
  test("timezone must be a real IANA zone", () => {
    expect(saveOrderPreferencesSchema.safeParse({ ...prefs, timezone: "America/New_York" }).success).toBe(true);
    expect(saveOrderPreferencesSchema.safeParse({ ...prefs, timezone: "Mars/Olympus" }).success).toBe(false);
  });
});

describe("saveBusinessHoursSchema (FR-083)", () => {
  const day = (weekday: number, over = {}) => ({
    weekday,
    enabled: true,
    opensAt: "09:00",
    closesAt: "18:00",
    ...over,
  });
  const week = [0, 1, 2, 3, 4, 5, 6].map((d) => day(d));
  test("seven rows, one per weekday", () => {
    expect(saveBusinessHoursSchema.safeParse({ days: week }).success).toBe(true);
    expect(saveBusinessHoursSchema.safeParse({ days: week.slice(0, 6) }).success).toBe(false);
    expect(saveBusinessHoursSchema.safeParse({ days: [...week.slice(0, 6), day(0)] }).success).toBe(false);
  });
  test("closing earlier than opening is allowed (overnight)", () => {
    const days = week.map((d) => (d.weekday === 5 ? { ...d, opensAt: "18:00", closesAt: "02:00" } : d));
    expect(saveBusinessHoursSchema.safeParse({ days }).success).toBe(true);
  });
  test("invalid time and equal opening/closing times are field errors", () => {
    const bad = (over: object) =>
      saveBusinessHoursSchema.safeParse({ days: week.map((d) => (d.weekday === 1 ? { ...d, ...over } : d)) });
    expect(bad({ opensAt: "25:00" }).success).toBe(false);
    expect(bad({ opensAt: "9:00" }).success).toBe(false);
    expect(bad({ closesAt: "09:00" }).success).toBe(false);
    const r = bad({ opensAt: "25:00" });
    if (r.success) throw new Error("should fail");
    expect(r.error.issues[0]?.path).toEqual(["days", 1, "opensAt"]);
  });
  test("a disabled day may keep any valid times", () => {
    expect(
      saveBusinessHoursSchema.safeParse({ days: week.map((d) => (d.weekday === 0 ? { ...d, enabled: false } : d)) })
        .success,
    ).toBe(true);
  });
});

describe("saveAutomaticMessageSchema (FR-084)", () => {
  test("kind, enabled, body 1..1000", () => {
    expect(saveAutomaticMessageSchema.safeParse({ kind: "welcome", enabled: true, body: "Oi {{nome}}" }).success).toBe(
      true,
    );
    expect(saveAutomaticMessageSchema.safeParse({ kind: "other", enabled: true, body: "x" }).success).toBe(false);
    expect(saveAutomaticMessageSchema.safeParse({ kind: "closed", enabled: true, body: "" }).success).toBe(false);
    expect(
      saveAutomaticMessageSchema.safeParse({ kind: "closed", enabled: true, body: "x".repeat(1001) }).success,
    ).toBe(false);
  });
  test("order_received may carry an approved template; name and language come together", () => {
    const ok = saveAutomaticMessageSchema.parse({
      kind: "order_received",
      enabled: true,
      body: "Pedido {{pedido}}",
      templateName: "pedido_recebido",
      templateLanguage: "pt_BR",
    });
    expect(ok).toMatchObject({ templateName: "pedido_recebido", templateLanguage: "pt_BR" });
    expect(
      saveAutomaticMessageSchema.safeParse({ kind: "order_received", enabled: true, body: "x", templateName: "a" })
        .success,
    ).toBe(false);
    expect(
      saveAutomaticMessageSchema.safeParse({
        kind: "order_received",
        enabled: true,
        body: "x",
        templateLanguage: "pt_BR",
      }).success,
    ).toBe(false);
  });
  test("every order status kind accepts a template (ADR-026)", () => {
    for (const kind of ["order_confirmed", "order_ready", "order_out_for_delivery", "order_cancelled"]) {
      expect(
        saveAutomaticMessageSchema.safeParse({
          kind,
          enabled: true,
          body: "x",
          templateName: "a",
          templateLanguage: "pt_BR",
        }).success,
      ).toBe(true);
    }
  });
  test("AUTOMATIC_MESSAGE_KINDS lists the seven kinds in settings order (FR-084, FR-200, ADR-028)", () => {
    expect([...AUTOMATIC_MESSAGE_KINDS]).toEqual([
      "welcome",
      "closed",
      "order_received",
      "order_confirmed",
      "order_ready",
      "order_out_for_delivery",
      "order_cancelled",
    ]);
  });
  test("order_preparing and order_delivered are no longer kinds (ADR-028)", () => {
    for (const kind of ["order_preparing", "order_delivered"]) {
      expect(saveAutomaticMessageSchema.safeParse({ kind, enabled: true, body: "x" }).success).toBe(false);
    }
  });
  test("templates do not apply to welcome or closed", () => {
    expect(
      saveAutomaticMessageSchema.safeParse({
        kind: "welcome",
        enabled: true,
        body: "x",
        templateName: "a",
        templateLanguage: "pt_BR",
      }).success,
    ).toBe(false);
  });
  test("omitted template fields become null", () => {
    expect(saveAutomaticMessageSchema.parse({ kind: "welcome", enabled: false, body: "x" })).toMatchObject({
      templateName: null,
      templateLanguage: null,
    });
  });
});
