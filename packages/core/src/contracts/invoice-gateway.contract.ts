// Contract suite for InvoiceGateway (ADR-003, FR-124). Runs against FakeInvoiceGateway and,
// with a stub server, against WebNfGateway.

import { describe, expect, test } from "bun:test";
import type { InvoiceRequestBody } from "../fiscal/invoice-request";
import { GatewayError } from "../ports/gateway-error";
import type { InvoiceGateway } from "../ports/invoice-gateway";

export interface InvoiceGatewayHarness {
  readonly gateway: InvoiceGateway;
  readonly cleanup?: () => Promise<void>;
}

const body = (reference: string): InvoiceRequestBody => ({
  kind: "nfce",
  reference,
  nfce: {
    serie: 1,
    operacao: { natureza: "Venda ao consumidor", presenca: "presencial" },
    itens: [
      {
        codigo: "AAAA0001",
        descricao: "Marmita",
        ncm: "21069090",
        cfop: "5101",
        unidade: "UN",
        quantidade: 1,
        valor_unitario: 25,
        impostos: { icms: { origem: "0", csosn: "102" }, pis: { cst: "49" }, cofins: { cst: "49" } },
      },
    ],
    pagamentos: [{ forma: "pix", valor: 25 }],
    informacoes_adicionais: `Pedido ${reference}`,
  },
});

async function failure(run: () => Promise<unknown>): Promise<GatewayError> {
  try {
    await run();
  } catch (e) {
    if (e instanceof GatewayError) return e;
    throw e;
  }
  throw new Error("expected a GatewayError");
}

export function invoiceGatewayContract(name: string, create: () => Promise<InvoiceGatewayHarness>): void {
  describe(`InvoiceGateway contract: ${name}`, () => {
    const withHarness = async (run: (h: InvoiceGatewayHarness) => Promise<void>) => {
      const h = await create();
      try {
        await run(h);
      } finally {
        await h.cleanup?.();
      }
    };

    test("createInvoice returns an id and a non-final status", async () => {
      await withHarness(async ({ gateway }) => {
        const r = await gateway.createInvoice(body("ORD-001"), "key-1");
        expect(r.id.length).toBeGreaterThan(0);
        expect(["received", "queued", "processing"]).toContain(r.status);
        expect(r.replayed).toBe(false);
      });
    });

    test("the same key and body replays the first result", async () => {
      await withHarness(async ({ gateway }) => {
        const a = await gateway.createInvoice(body("ORD-002"), "key-2");
        const b = await gateway.createInvoice(body("ORD-002"), "key-2");
        expect(b.id).toBe(a.id);
        expect(b.replayed).toBe(true);
      });
    });

    test("the same key with another body is a 409 idempotency_conflict", async () => {
      await withHarness(async ({ gateway }) => {
        await gateway.createInvoice(body("ORD-003"), "key-3");
        const e = await failure(() => gateway.createInvoice(body("ORD-003-b"), "key-3"));
        expect(e.failure).toEqual({ kind: "http", status: 409, code: "idempotency_conflict" });
      });
    });

    test("getInvoice returns the stored invoice", async () => {
      await withHarness(async ({ gateway }) => {
        const created = await gateway.createInvoice(body("ORD-004"), "key-4");
        const view = await gateway.getInvoice(created.id);
        expect(view.id).toBe(created.id);
        expect(view.kind).toBe("nfce");
        expect(typeof view.status).toBe("string");
      });
    });

    test("getInvoice for an unknown id is a 404 not_found", async () => {
      await withHarness(async ({ gateway }) => {
        const e = await failure(() => gateway.getInvoice("does-not-exist"));
        expect(e.failure).toMatchObject({ kind: "http", status: 404 });
      });
    });

    test("cancelling an invoice that is not authorized is a 409 conflict", async () => {
      await withHarness(async ({ gateway }) => {
        const created = await gateway.createInvoice(body("ORD-005"), "key-5");
        const e = await failure(() => gateway.cancelInvoice(created.id, "Pedido lançado em duplicidade", "cancel-5"));
        expect(e.failure).toMatchObject({ kind: "http", status: 409 });
      });
    });

    test("testConnection answers ok or an error text", async () => {
      await withHarness(async ({ gateway }) => {
        const r = await gateway.testConnection();
        expect(typeof r.ok).toBe("boolean");
      });
    });
  });
}
