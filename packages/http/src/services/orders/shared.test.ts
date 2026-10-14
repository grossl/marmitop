// covers FR-034, FR-020
import { describe, expect, test } from "bun:test";

import { formatAddressLine, likePattern, toBoardOrder } from "./shared";

describe("formatAddressLine (FR-034)", () => {
  test("joins the parts into one line", () => {
    expect(
      formatAddressLine({
        logradouro: "Rua das Flores",
        numero: "120",
        complemento: "Apto 3",
        bairro: "Centro",
        cidade: "São Paulo",
        uf: "SP",
      }),
    ).toBe("Rua das Flores, 120 - Apto 3 - Centro - São Paulo/SP");
  });
  test("drops empty parts", () => {
    expect(formatAddressLine({ logradouro: "Rua A", numero: " ", bairro: "Centro", cidade: null, uf: "SP" })).toBe(
      "Rua A - Centro - SP",
    );
    expect(formatAddressLine({})).toBe("");
  });
});

describe("likePattern", () => {
  test("escapes wildcard characters", () => {
    expect(likePattern("50%_a\\b")).toBe("%50\\%\\_a\\\\b%");
  });
});

describe("toBoardOrder (FR-021, ADR-017)", () => {
  const base = {
    id: "1",
    code: "ORD-001",
    status: "aguardando",
    fulfillment: "pickup",
    customer_id: "c",
    customer_name: "Ana",
    customer_phone: "+5511999990000",
    cep: null,
    logradouro: "Rua A",
    numero: null,
    complemento: null,
    bairro: "Centro",
    cidade: null,
    uf: null,
    payment_method: "pix",
    change_for_cents: null,
    notes: null,
    subtotal_cents: 1000,
    delivery_fee_cents: 0,
    total_cents: 1000,
    source: "counter",
    conversation_id: null,
    created_at: new Date("2026-10-13T15:00:00Z"),
    delivered_at: null,
    cancelled_at: null,
    cancel_reason: null,
    items: [],
  } as const;
  test("a pickup order never lists saiu as a target", () => {
    const view = toBoardOrder(base);
    expect(view.allowedStatuses).not.toContain("saiu");
    expect(view.allowedStatuses).toContain("preparando");
    expect(view.addressLine).toBe("Retirada no balcão");
    expect(view.createdAt).toBe("2026-10-13T15:00:00.000Z");
  });
  test("a final order has no targets", () => {
    expect(toBoardOrder({ ...base, status: "entregue" }).allowedStatuses).toEqual([]);
  });
  test("the card carries the latest invoice status for the badge (FR-139)", () => {
    expect(toBoardOrder(base).invoiceStatus).toBeNull();
    expect(toBoardOrder({ ...base, invoice_status: "authorized" }).invoiceStatus).toBe("authorized");
  });
});
