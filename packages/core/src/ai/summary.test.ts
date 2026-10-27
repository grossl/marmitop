// covers FR-186
import { describe, expect, test } from "bun:test";

import { formatBRL } from "../money";
import { renderOrderSummary } from "./summary";

const total = {
  items: [
    {
      menuItemId: "f",
      name: "Marmita de Frango",
      sizeName: "Grande",
      unitPriceCents: 2200,
      qty: 2,
      lineTotalCents: 4400,
      notes: "sem cebola",
      position: 0,
    },
    {
      menuItemId: "c",
      name: "Coca-Cola Lata",
      sizeName: null,
      unitPriceCents: 600,
      qty: 1,
      lineTotalCents: 600,
      notes: null,
      position: 1,
    },
  ],
  subtotalCents: 5000,
  deliveryFeeCents: 500,
  totalCents: 5500,
};

describe("renderOrderSummary", () => {
  test("delivery with complemento", () => {
    const text = renderOrderSummary({
      total,
      fulfillment: "delivery",
      address: { logradouro: "Rua das Flores", numero: "120", bairro: "Centro", complemento: "apto 3" },
    });
    expect(text).toBe(
      [
        "Seu pedido:",
        `2x Marmita de Frango (Grande) — ${formatBRL(4400)}`,
        "   obs: sem cebola",
        `1x Coca-Cola Lata — ${formatBRL(600)}`,
        `Taxa de entrega — ${formatBRL(500)}`,
        `*Total: ${formatBRL(5500)}*`,
        "Entrega: Rua das Flores, 120, apto 3 — Centro",
        "",
        "Posso confirmar o pedido?",
      ].join("\n"),
    );
  });
  test("pickup has no fee line and says Retirada", () => {
    const text = renderOrderSummary({
      total: { ...total, deliveryFeeCents: 0, totalCents: 5000 },
      fulfillment: "pickup",
      address: { logradouro: null, numero: null, bairro: null, complemento: null },
    });
    expect(text).not.toContain("Taxa de entrega");
    expect(text).toContain("Retirada no restaurante");
  });
  test("delivery without numero or complemento", () => {
    const text = renderOrderSummary({
      total,
      fulfillment: "delivery",
      address: { logradouro: "Rua A", numero: null, bairro: "Centro", complemento: null },
    });
    expect(text).toContain("Entrega: Rua A — Centro");
  });
});
