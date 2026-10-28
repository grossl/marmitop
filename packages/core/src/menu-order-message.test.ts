// covers FR-238
import { describe, expect, test } from "bun:test";

import { formatMenuOrderMessage, type MenuOrderMessageInput } from "./menu-order-message";

const base: MenuOrderMessageInput = {
  code: "ORD-012",
  customerName: "Ana",
  lines: [
    { qty: 2, name: "Frango grelhado", sizeName: "M", lineTotalCents: 3780 },
    { qty: 1, name: "Suco de laranja", sizeName: null, lineTotalCents: 800 },
  ],
  subtotalCents: 4580,
  deliveryFeeCents: 500,
  totalCents: 5080,
  fulfillment: "delivery",
  logradouro: "Rua das Flores",
  numero: "123",
  complemento: "apto 4",
  bairro: "Centro",
  paymentMethod: "dinheiro",
  changeForCents: 10000,
  notes: "sem cebola",
};

describe("formatMenuOrderMessage", () => {
  test("a delivery order lists the code, items, totals, address, payment, notes and name", () => {
    expect(formatMenuOrderMessage(base)).toBe(
      [
        "Olá! Quero fazer um pedido pelo cardápio online.",
        "",
        "*Pedido ORD-012*",
        "2x Frango grelhado (M) — R$ 37,80",
        "1x Suco de laranja — R$ 8,00",
        "",
        "Subtotal: R$ 45,80",
        "Entrega: R$ 5,00",
        "*Total: R$ 50,80*",
        "",
        "*Entrega*",
        "Rua das Flores, 123 — apto 4",
        "Centro",
        "",
        "Pagamento: Dinheiro (troco para R$ 100,00)",
        "Observações: sem cebola",
        "",
        "Nome: Ana",
      ].join("\n"),
    );
  });

  test("a pickup order has no fee line and no address", () => {
    const text = formatMenuOrderMessage({
      ...base,
      fulfillment: "pickup",
      deliveryFeeCents: 0,
      totalCents: 4580,
      paymentMethod: "pix",
      changeForCents: null,
      notes: null,
    });
    expect(text).toContain("*Retirada no local*");
    expect(text).not.toContain("Entrega:");
    expect(text).not.toContain("Rua das Flores");
    expect(text).not.toContain("Observações");
    expect(text).toContain("Pagamento: Pix\n");
  });

  test("uses plain spaces, not the non-breaking space of the currency format", () => {
    expect(formatMenuOrderMessage(base)).not.toContain(" ");
  });
});
