// covers FR-120, FR-122, FR-130, FR-135, FR-070, FR-075
import { describe, expect, test } from "bun:test";
import { cancelInvoiceSchema, issueInvoiceSchema, orderInvoiceRefSchema } from "./invoices";
import { getReportsSchema } from "./reports";

const U = "3f6c1a0e-7a3b-4b1e-9c53-1f3f6d0f6a11";

describe("issueInvoiceSchema (FR-120, FR-122)", () => {
  test("kind defaults to nfce; nfe is allowed", () => {
    expect(issueInvoiceSchema.parse({ orderId: U })).toEqual({ orderId: U, kind: "nfce", identifyBuyer: false });
    expect(issueInvoiceSchema.parse({ orderId: U, kind: "nfe" }).kind).toBe("nfe");
    expect(issueInvoiceSchema.safeParse({ orderId: U, kind: "nfse" }).success).toBe(false);
  });
  test("the missing-data form fills CPF/CNPJ and address parts (FR-125, ADR-016)", () => {
    const parsed = issueInvoiceSchema.parse({
      orderId: U,
      fill: { cpfCnpj: "529.982.247-25", cep: "01310-100", uf: "sp", codigoMunicipio: "3550308", numero: "12" },
    });
    expect(parsed.fill).toMatchObject({
      cpfCnpj: "52998224725",
      cep: "01310100",
      uf: "SP",
      codigoMunicipio: "3550308",
    });
    expect(issueInvoiceSchema.safeParse({ orderId: U, fill: { cpfCnpj: "111.111.111-11" } }).success).toBe(false);
    expect(issueInvoiceSchema.safeParse({ orderId: U, fill: { cep: "123" } }).success).toBe(false);
  });
  test('"CPF na nota" for pickup orders', () => {
    expect(issueInvoiceSchema.parse({ orderId: U, identifyBuyer: true }).identifyBuyer).toBe(true);
  });
});

describe("cancelInvoiceSchema (FR-130)", () => {
  test("the justification has 15 to 255 characters", () => {
    expect(
      cancelInvoiceSchema.safeParse({ orderInvoiceId: U, justificativa: "Pedido lançado em duplicidade" }).success,
    ).toBe(true);
    expect(cancelInvoiceSchema.safeParse({ orderInvoiceId: U, justificativa: "curto demais" }).success).toBe(false);
    expect(cancelInvoiceSchema.safeParse({ orderInvoiceId: U, justificativa: "x".repeat(256) }).success).toBe(false);
    expect(
      cancelInvoiceSchema.parse({ orderInvoiceId: U, justificativa: "   Pedido lançado em duplicidade   " })
        .justificativa,
    ).toBe("Pedido lançado em duplicidade");
  });
});

describe("orderInvoiceRefSchema", () => {
  test("getInvoiceFiles and refreshInvoice take the invoice id", () => {
    expect(orderInvoiceRefSchema.safeParse({ orderInvoiceId: U }).success).toBe(true);
    expect(orderInvoiceRefSchema.safeParse({ orderInvoiceId: "x" }).success).toBe(false);
  });
});

describe("getReportsSchema (FR-070)", () => {
  test("from and to are local days, in order, at most 366 days apart", () => {
    expect(getReportsSchema.safeParse({ from: "2026-10-01", to: "2026-10-31" }).success).toBe(true);
    expect(getReportsSchema.safeParse({ from: "2026-10-31", to: "2026-10-01" }).success).toBe(false);
    expect(getReportsSchema.safeParse({ from: "2026-10-01", to: "2026-10-1" }).success).toBe(false);
    expect(getReportsSchema.safeParse({ from: "2026-02-30", to: "2026-03-01" }).success).toBe(false);
    expect(getReportsSchema.safeParse({ from: "2025-01-01", to: "2026-10-31" }).success).toBe(false);
    expect(getReportsSchema.safeParse({ from: "2026-10-13", to: "2026-10-13" }).success).toBe(true);
  });
});
