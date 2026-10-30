// covers FR-253
import { describe, expect, test } from "bun:test";

import { encodeCp860, encodeEscPos } from "./escpos";
import { formatTicketPhone, type OrderTicketInput, renderOrderTicket, wrapText } from "./render";

const pickup: OrderTicketInput = {
  restaurantName: "Marmita da Casa",
  timezone: "America/Sao_Paulo",
  code: "ORD-012",
  fulfillment: "pickup",
  source: "whatsapp",
  createdAt: new Date("2026-10-30T16:48:00Z"),
  customerName: "Ana Souza",
  customerPhone: "5511999990000",
  items: [
    { name: "Frango Grelhado", sizeName: "M", unitPriceCents: 1890, qty: 2, notes: "sem cebola" },
    { name: "Refrigerante lata", sizeName: null, unitPriceCents: 600, qty: 1, notes: null },
  ],
  notes: null,
  logradouro: null,
  numero: null,
  complemento: null,
  bairro: null,
  cidade: null,
  uf: null,
  cep: null,
  paymentMethod: "pix",
  changeForCents: null,
  subtotalCents: 4380,
  deliveryFeeCents: 0,
  totalCents: 4380,
};

const delivery: OrderTicketInput = {
  ...pickup,
  fulfillment: "delivery",
  notes: "Tocar a campainha duas vezes",
  logradouro: "Rua das Flores",
  numero: "342",
  complemento: "apto 21",
  bairro: "Vila Madalena",
  cidade: "São Paulo",
  uf: "SP",
  cep: "05435000",
  paymentMethod: "dinheiro",
  changeForCents: 5000,
  deliveryFeeCents: 500,
  totalCents: 4880,
};

const texts = (input: OrderTicketInput) => renderOrderTicket(input).map((l) => l.text);

describe("renderOrderTicket", () => {
  test("a pickup ticket has the header, the customer, the items, and the total", () => {
    const lines = renderOrderTicket(pickup);
    expect(lines[0]).toEqual({ text: "MARMITA DA CASA", align: "center", bold: true });
    expect(lines).toContainEqual({ text: "ORD-012", align: "center", bold: true, size: "double" });
    expect(lines).toContainEqual({ text: "RETIRADA", align: "center", bold: true, size: "double" });
    const t = texts(pickup);
    expect(t).toContain(`30/10/2026 13:48${" ".repeat(48 - 16 - 8)}WhatsApp`);
    expect(t).toContain("Cliente: Ana Souza");
    expect(t).toContain("Tel: (11) 99999-0000");
    expect(t).toContain(`2x Frango Grelhado (M)${" ".repeat(48 - 22 - 8)}R$ 37,80`);
    expect(t).toContain("   obs: sem cebola");
    expect(t).toContain("Pagamento: Pix");
    expect(t.some((l) => l.startsWith("ENDEREÇO"))).toBe(false);
    expect(t.some((l) => l.startsWith("Taxa de entrega"))).toBe(false);
    expect(lines).toContainEqual({ text: `TOTAL${" ".repeat(24 - 5 - 8)}R$ 43,80`, bold: true, size: "double" });
  });

  test("a delivery ticket has the address, the fee, the notes, and the change", () => {
    const t = texts(delivery);
    expect(t).toContain("ENTREGA");
    expect(t).toContain("Rua das Flores, 342 - apto 21");
    expect(t).toContain("Vila Madalena - São Paulo/SP");
    expect(t).toContain("CEP 05435-000");
    expect(t).toContain("OBSERVAÇÕES");
    expect(t).toContain("Tocar a campainha duas vezes");
    expect(t).toContain(`Taxa de entrega${" ".repeat(48 - 15 - 7)}R$ 5,00`);
    expect(t).toContain("Troco para R$ 50,00 (levar R$ 1,20)");
  });

  test("no line is wider than the paper; a long item name wraps under its price", () => {
    const long = {
      ...pickup,
      items: [
        {
          name: "Marmita executiva de feijoada completa com couve, farofa e laranja",
          sizeName: "G",
          unitPriceCents: 3290,
          qty: 1,
          notes: null,
        },
      ],
    };
    const lines = renderOrderTicket(long);
    for (const l of lines) expect(l.text.length).toBeLessThanOrEqual(l.size === "double" ? 24 : 48);
    const at = lines.findIndex((l) => l.text.startsWith("1x Marmita"));
    expect(lines[at]?.text.endsWith("R$ 32,90")).toBe(true);
    expect(lines[at + 1]?.text.startsWith("   ")).toBe(true);
  });

  test("an AI order without a payment method prints A definir", () => {
    expect(texts({ ...pickup, paymentMethod: null })).toContain("Pagamento: A definir");
  });

  test("a narrower paper renders at its width", () => {
    for (const l of renderOrderTicket(delivery, 32))
      expect(l.text.length).toBeLessThanOrEqual(l.size === "double" ? 16 : 32);
  });
});

describe("helpers", () => {
  test("wrapText breaks at spaces and splits a word longer than the width", () => {
    expect(wrapText("um dois tres", 7)).toEqual(["um dois", "tres"]);
    expect(wrapText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  test("formatTicketPhone formats Brazilian mobile and landline numbers", () => {
    expect(formatTicketPhone("5511999990000")).toBe("(11) 99999-0000");
    expect(formatTicketPhone("1133334444")).toBe("(11) 3333-4444");
    expect(formatTicketPhone("+1 555")).toBe("+1 555");
  });
});

describe("encodeEscPos", () => {
  test("Portuguese letters use code page 860", () => {
    expect(encodeCp860("ç ã é ô Ç Õ")).toEqual([0x87, 0x20, 0x84, 0x20, 0x82, 0x20, 0x93, 0x20, 0x80, 0x20, 0x99]);
  });

  test("a character outside code page 860 loses its accent, or prints as ?", () => {
    expect(encodeCp860("ŝ—…")).toEqual([0x73, 0x2d, 0x2e, 0x2e, 0x2e]);
    expect(encodeCp860("🍛")).toEqual([0x3f]);
  });

  test("the bytes start with init and code page 860, style each line, and end with feed and cut", () => {
    const bytes = [...encodeEscPos([{ text: "Oi", bold: true, align: "center", size: "double" }])];
    expect(bytes.slice(0, 5)).toEqual([0x1b, 0x40, 0x1b, 0x74, 3]);
    expect(bytes.slice(5, 17)).toEqual([0x1b, 0x61, 1, 0x1b, 0x45, 1, 0x1d, 0x21, 0x11, 0x4f, 0x69, 0x0a]);
    expect(bytes.slice(-7)).toEqual([0x1b, 0x64, 4, 0x1d, 0x56, 0x42, 0]);
    expect([...encodeEscPos([], { cut: false })].slice(-3)).toEqual([0x1b, 0x64, 4]);
  });
});
