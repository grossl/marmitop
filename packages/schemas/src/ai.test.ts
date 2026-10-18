// covers FR-180, FR-184
import { describe, expect, test } from "bun:test";

import { aiTurnJobSchema, handoffInputSchema, saveAiSettingsSchema, updateCartInputSchema } from "./ai";

describe("AI schemas", () => {
  test("aiTurnJobSchema", () => {
    const job = {
      v: 1 as const,
      restaurantId: crypto.randomUUID(),
      conversationId: crypto.randomUUID(),
      triggerMessageId: crypto.randomUUID(),
      enqueuedAt: "2026-10-17T15:00:00.000Z",
    };
    expect(aiTurnJobSchema.parse(job)).toEqual(job);
    expect(() => aiTurnJobSchema.parse({ ...job, enqueuedAt: "ontem" })).toThrow();
  });
  test("updateCartInputSchema accepts the strict tool shape and rejects extras", () => {
    const ok = {
      items: [{ menu_item_id: crypto.randomUUID(), size_id: null, quantity: 2, notes: null }],
      fulfillment: "delivery" as const,
      address: { logradouro: "Rua A", numero: null, bairro: "Centro", complemento: null },
      customer_name: null,
    };
    expect(updateCartInputSchema.parse(ok)).toEqual(ok);
    expect(() => updateCartInputSchema.parse({ ...ok, restaurant_id: "x" })).toThrow();
    expect(() => updateCartInputSchema.parse({ ...ok, items: [{ ...ok.items[0], quantity: 0 }] })).toThrow();
  });
  test("handoff note is at most 200 characters", () => {
    expect(() => handoffInputSchema.parse({ reason: "complaint", note: "x".repeat(201) })).toThrow();
  });
  test("settings bounds", () => {
    const base = {
      enabled: true,
      personaName: "Ana",
      extraInstructions: null,
      autoResumeMinutes: 360,
      allowOverage: false,
      monthlyHardCap: 20000,
    };
    expect(saveAiSettingsSchema.parse(base)).toEqual(base);
    expect(() => saveAiSettingsSchema.parse({ ...base, personaName: "" })).toThrow();
    expect(() => saveAiSettingsSchema.parse({ ...base, extraInstructions: "x".repeat(1001) })).toThrow();
  });
});
