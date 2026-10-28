// covers FR-238, FR-239
import { describe, expect, test } from "bun:test";

import { formatMenuOrderMessage, MENU_ORDER_REFERENCE_IN_TEXT, type MenuOrderMessageInput } from "./menu-order-message";

const base: MenuOrderMessageInput = {
  reference: "K7Q2MX9A",
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
        "Olá! Quero fazer este pedido pelo cardápio online:",
        "",
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
        "",
        "Ref.: #K7Q2MX9A",
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

describe("MENU_ORDER_REFERENCE_IN_TEXT", () => {
  test("finds the reference in the sent text, also when the customer adds words", () => {
    expect(formatMenuOrderMessage(base).match(MENU_ORDER_REFERENCE_IN_TEXT)?.[1]).toBe("K7Q2MX9A");
    expect("oi, segue #K7Q2MX9A obrigado".match(MENU_ORDER_REFERENCE_IN_TEXT)?.[1]).toBe("K7Q2MX9A");
  });

  test("ignores lowercase, short, long, and ambiguous references", () => {
    for (const text of ["#k7q2mx9a", "#K7Q2MX9", "#K7Q2MX9AB", "#K7Q2MX0A", "K7Q2MX9A"]) {
      expect(text.match(MENU_ORDER_REFERENCE_IN_TEXT)).toBeNull();
    }
  });
});
