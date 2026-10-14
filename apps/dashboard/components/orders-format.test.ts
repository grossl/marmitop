// covers FR-020, FR-035, FR-037
import { describe, expect, test } from "bun:test";

import {
  canIssueInvoice,
  fillKey,
  formatCents,
  formatChave,
  formatTime,
  initials,
  invoiceBadge,
  isCnpj,
  isInvoicePending,
  MISSING_FIELD_LABELS,
  parseMoneyToCents,
} from "./orders-format";

describe("orders-format", () => {
  test("formatCents never goes through floats", () => {
    expect(formatCents(0)).toBe("R$ 0,00");
    expect(formatCents(1890)).toBe("R$ 18,90");
    expect(formatCents(123456789)).toBe("R$ 1.234.567,89");
    expect(formatCents(5)).toBe("R$ 0,05");
  });
  test("parseMoneyToCents", () => {
    expect(parseMoneyToCents("50")).toBe(5000);
    expect(parseMoneyToCents("R$ 12,5")).toBe(1250);
    expect(parseMoneyToCents("12.34")).toBe(1234);
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("1,234")).toBeNull();
  });
  test("formatTime uses the restaurant timezone", () => {
    expect(formatTime("2026-10-13T15:00:00Z", "America/Sao_Paulo")).toBe("12:00");
  });
  test("initials", () => {
    expect(initials("Maria da Silva")).toBe("MS");
    expect(initials("")).toBe("?");
  });
});

// covers FR-122, FR-125, FR-128, FR-132, FR-139
describe("invoice display (08 section 8.4)", () => {
  test("invoiceBadge labels and tones", () => {
    expect(invoiceBadge("authorized", "nfce")).toEqual({ label: "NFC-e emitida", tone: "green" });
    expect(invoiceBadge("authorized", "nfe")).toEqual({ label: "NF-e emitida", tone: "green" });
    expect(invoiceBadge("authorized")).toEqual({ label: "NF emitida", tone: "green" });
    for (const s of ["queued", "received", "processing"]) {
      expect(invoiceBadge(s, "nfce")).toEqual({ label: "Em processamento", tone: "blue" });
    }
    expect(invoiceBadge("rejected", "nfce")).toEqual({ label: "Rejeitada", tone: "red" });
    expect(invoiceBadge("denied", "nfce")).toEqual({ label: "Denegada", tone: "red" });
    expect(invoiceBadge("failed", "nfce")).toEqual({ label: "Falhou", tone: "amber" });
    expect(invoiceBadge("cancelled", "nfce")).toEqual({ label: "Cancelada", tone: "grey" });
  });
  test("an order can issue again only after a final non-authorized invoice (FR-132)", () => {
    expect(canIssueInvoice(null)).toBe(true);
    expect(canIssueInvoice("rejected")).toBe(true);
    expect(canIssueInvoice("cancelled")).toBe(true);
    expect(canIssueInvoice("queued")).toBe(false);
    expect(canIssueInvoice("authorized")).toBe(false);
  });
  test("a live invoice keeps polling", () => {
    expect(isInvoicePending("received")).toBe(true);
    expect(isInvoicePending("authorized")).toBe(false);
  });
  test("missing-field paths have pt-BR labels for the short form (FR-125)", () => {
    expect(MISSING_FIELD_LABELS["customer.cpf_cnpj"]).toBe("CPF/CNPJ");
    expect(MISSING_FIELD_LABELS["address.codigo_municipio"]).toBe("Código IBGE do município");
    expect(fillKey("address.codigo_municipio")).toBe("codigoMunicipio");
    expect(fillKey("customer.cpf_cnpj")).toBe("cpfCnpj");
    expect(fillKey("address.cep")).toBe("cep");
  });
  test("isCnpj accepts 14 digits only (FR-122)", () => {
    expect(isCnpj("11222333000181")).toBe(true);
    expect(isCnpj("52998224725")).toBe(false);
    expect(isCnpj(null)).toBe(false);
  });
  test("formatChave groups the access key by four digits", () => {
    expect(formatChave("4".repeat(44))).toBe(Array(11).fill("4444").join(" "));
  });
});
