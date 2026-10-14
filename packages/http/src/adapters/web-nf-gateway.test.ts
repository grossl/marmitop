// covers FR-124, FR-127, FR-129, FR-130, FR-137, FR-138, ADR-003
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { classifyUpstreamFailure, GatewayError, type InvoiceRequestBody } from "@mt/core";
import { invoiceGatewayContract } from "@mt/core/contracts";

import { FakeWebNfServer } from "../testing/fake-web-nf-server";
import { createSafeFetch } from "./safe-fetch";
import { WebNfGateway } from "./web-nf-gateway";

const devFetch = (timeoutMs = 2000) => createSafeFetch({ allowPrivateHosts: true, timeoutMs });

invoiceGatewayContract("WebNfGateway against a local web-nf stand-in", async () => {
  const server = new FakeWebNfServer().start();
  const gateway = new WebNfGateway({ baseUrl: server.baseUrl, apiKey: server.apiKey, fetch: devFetch() });
  return { gateway, cleanup: () => server.stop() };
});

let server: FakeWebNfServer;
let gateway: WebNfGateway;

beforeEach(() => {
  server = new FakeWebNfServer().start();
  gateway = new WebNfGateway({ baseUrl: `${server.baseUrl}/`, apiKey: server.apiKey, fetch: devFetch(300) });
});

afterEach(async () => {
  await server.stop();
});

async function failure(p: Promise<unknown>): Promise<GatewayError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof GatewayError) return e;
    throw new Error(`expected a GatewayError, got ${String(e)}`);
  }
  throw new Error("expected a failure");
}

const payload: InvoiceRequestBody = {
  kind: "nfce",
  reference: "0d9e2b34-5c11-4e7a-8d2f-6a5b9c0e1f22",
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
        valor_unitario: 25.9,
        impostos: { icms: { origem: "0", csosn: "102" }, pis: { cst: "49" }, cofins: { cst: "49" } },
      },
    ],
    pagamentos: [{ forma: "pix", valor: 25.9 }],
    informacoes_adicionais: "Pedido ORD-001",
  },
};

describe("WebNfGateway requests", () => {
  test("createInvoice posts the body byte for byte with the Bearer key and the Idempotency-Key", async () => {
    const r = await gateway.createInvoice(payload, "key-1");
    const req = server.requests.at(-1);
    expect(req?.method).toBe("POST");
    expect(req?.path).toBe("/v1/invoices");
    expect(req?.authorization).toBe(`Bearer ${server.apiKey}`);
    expect(req?.idempotencyKey).toBe("key-1");
    expect(req?.rawBody).toBe(JSON.stringify(payload));
    expect(r).toEqual({ id: expect.any(String), status: "queued", replayed: false });
  });

  test("a replay reports replayed: true with the same id", async () => {
    const a = await gateway.createInvoice(payload, "key-2");
    const b = await gateway.createInvoice(payload, "key-2");
    expect(b).toEqual({ id: a.id, status: "queued", replayed: true });
  });

  test("getInvoice maps numero, serie, chave, files, authorizedAt, and events", async () => {
    const { id } = await gateway.createInvoice(payload, "key-3");
    server.authorize(id, new Date("2026-10-13T15:00:00Z"));
    const view = await gateway.getInvoice(id);
    expect(view.status).toBe("authorized");
    expect(view.numero).toBe(1);
    expect(view.serie).toBe(1);
    expect(view.chaveAcesso).toHaveLength(44);
    expect(view.files?.xml).toContain("/files/");
    expect(view.files?.pdf).toContain(".pdf");
    expect(view.authorizedAt).toBe("2026-10-13T15:00:00.000Z");
    expect(view.events).toEqual([]);
    expect(view.error).toBeNull();
  });

  test("an alphanumeric serie becomes null; a missing file stays absent", async () => {
    const { id } = await gateway.createInvoice(payload, "key-4");
    const inv = server.invoices.get(id);
    if (inv) inv.serie = "A1";
    const view = await gateway.getInvoice(id);
    expect(view.serie).toBeNull();
    expect(view.files).toEqual({});
  });

  test("a rejected invoice carries the SEFAZ code and text", async () => {
    const { id } = await gateway.createInvoice(payload, "key-5");
    server.reject(id, "539", "Rejeição: Duplicidade de NF-e");
    const view = await gateway.getInvoice(id);
    expect(view.status).toBe("rejected");
    expect(view.error).toEqual({ code: "539", message: "Rejeição: Duplicidade de NF-e" });
  });

  test("cancelInvoice posts a cancelamento event with its own Idempotency-Key and answers the event status", async () => {
    const { id } = await gateway.createInvoice(payload, "key-6");
    server.authorize(id);
    const r = await gateway.cancelInvoice(id, "Pedido lançado em duplicidade", "cancel-6");
    const req = server.requests.at(-1);
    expect(req?.path).toBe(`/v1/invoices/${id}/events`);
    expect(req?.idempotencyKey).toBe("cancel-6");
    expect(req?.body).toEqual({ type: "cancelamento", justificativa: "Pedido lançado em duplicidade" });
    expect(r).toEqual({ status: "queued" });
    const view = await gateway.getInvoice(id);
    expect(view.events?.[0]).toMatchObject({ type: "cancelamento", status: "queued" });
  });

  test("the invoice id is path-encoded", async () => {
    await failure(gateway.getInvoice("../health"));
    expect(server.requests.at(-1)?.path).toBe("/v1/invoices/..%2Fhealth");
  });
});

describe("WebNfGateway error classification", () => {
  test("422 validation_failed keeps the code and the details", async () => {
    server.scriptNext("POST /v1/invoices", {
      kind: "status",
      status: 422,
      code: "validation_failed",
      details: [{ path: "nfce.itens[0].ncm", code: "invalid_format", message: "NCM must have 8 digits." }],
    });
    const e = await failure(gateway.createInvoice(payload, "k"));
    expect(e.failure).toEqual({ kind: "http", status: 422, code: "validation_failed" });
    expect(e.details).toEqual([
      { path: "nfce.itens[0].ncm", code: "invalid_format", message: "NCM must have 8 digits." },
    ]);
    expect(classifyUpstreamFailure(e.failure).failure).toBe("permanent");
  });

  test("429 carries Retry-After and is transient", async () => {
    server.scriptNext("POST /v1/invoices", { kind: "status", status: 429, code: "rate_limited", retryAfter: "7" });
    const e = await failure(gateway.createInvoice(payload, "k"));
    expect(e.retryAfterMs).toBe(7000);
    expect(classifyUpstreamFailure(e.failure).failure).toBe("transient");
  });

  test("a 5xx is transient (FR-137)", async () => {
    server.scriptNext("POST /v1/invoices", { kind: "status", status: 503 });
    const e = await failure(gateway.createInvoice(payload, "k"));
    expect(classifyUpstreamFailure(e.failure)).toEqual({ failure: "transient", errorCode: "upstream_error" });
  });

  test("a timeout is transient: the same key makes the retry safe", async () => {
    server.scriptNext("POST /v1/invoices", { kind: "delay", ms: 600 });
    const e = await failure(gateway.createInvoice(payload, "k"));
    expect(e.failure.kind).toBe("timeout");
    expect(classifyUpstreamFailure(e.failure).failure).toBe("transient");
  });

  test("an unreadable 2xx is a network error (retry with the same key)", async () => {
    server.scriptNext("POST /v1/invoices", { kind: "garbage" });
    const e = await failure(gateway.createInvoice(payload, "k"));
    expect(e.failure.kind).toBe("network_error");
  });

  test("a wrong key is 401 unauthorized", async () => {
    const bad = new WebNfGateway({ baseUrl: server.baseUrl, apiKey: "nfk_test_wrong", fetch: devFetch() });
    const e = await failure(bad.getInvoice("0d9e2b34-5c11-4e7a-8d2f-6a5b9c0e1f22"));
    expect(e.failure).toEqual({ kind: "http", status: 401, code: "unauthorized" });
  });

  test("an error never carries the API key in its message (FR-138)", async () => {
    server.scriptNext("POST /v1/invoices", { kind: "status", status: 500 });
    const e = await failure(gateway.createInvoice(payload, "k"));
    expect(e.message).not.toContain(server.apiKey);
  });
});

describe("WebNfGateway.testConnection (FR-091)", () => {
  test("ok when the key passes auth (an unknown invoice answers 404)", async () => {
    expect(await gateway.testConnection()).toEqual({ ok: true });
  });

  test("a refused key is a pt-BR error", async () => {
    const bad = new WebNfGateway({ baseUrl: server.baseUrl, apiKey: "nfk_test_wrong", fetch: devFetch() });
    expect(await bad.testConnection()).toEqual({ ok: false, error: "A chave de API foi recusada pelo web-nf." });
  });

  test("an unreachable host is a pt-BR error", async () => {
    const url = server.baseUrl;
    await server.stop();
    const g = new WebNfGateway({ baseUrl: url, apiKey: "nfk_test_fake", fetch: devFetch() });
    expect(await g.testConnection()).toEqual({ ok: false, error: "Não foi possível conectar ao web-nf." });
  });
});
