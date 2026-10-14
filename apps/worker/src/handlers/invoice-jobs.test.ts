// covers FR-124, FR-125, FR-127, FR-130, FR-136, FR-137, ADR-003, ADR-016 (frozen payload)
import { beforeEach, describe, expect, test } from "bun:test";
import { FakeInvoiceGateway, GatewayError, type InvoiceRequestBody, type InvoiceView } from "@mt/core";
import { QUEUES } from "@mt/db";
import type { InvoiceJob } from "@mt/schemas";

import type { JobContext } from "../framework/types";
import {
  type CancelLoad,
  createInvoiceCancelHandler,
  createInvoiceIssueHandler,
  createInvoicePollHandler,
  type InvoiceJobStore,
  type IssueLoad,
  MAX_POLL_ROUNDS,
  pollDelaySeconds,
  type PollLoad,
} from "./invoice-jobs";

const R = "3f6c1a0e-7a3b-4b1e-9c53-1f3f6d0f6a11";
const I = "0d9e2b34-5c11-4e7a-8d2f-6a5b9c0e1f22";
const conn = { baseUrl: "http://web-nf.local", apiKey: "nfk_test_x" };

const payload: InvoiceRequestBody = {
  kind: "nfce",
  reference: I,
  nfce: {
    serie: 1,
    operacao: { natureza: "Venda ao consumidor", presenca: "presencial" },
    itens: [
      {
        codigo: "AAAA0001",
        descricao: "Marmita de frango (Grande)",
        ncm: "21069090",
        cfop: "5101",
        unidade: "UN",
        quantidade: 1,
        valor_unitario: 25,
        impostos: { icms: { origem: "0", csosn: "102" }, pis: { cst: "49" }, cofins: { cst: "49" } },
      },
    ],
    pagamentos: [{ forma: "pix", valor: 25 }],
    informacoes_adicionais: "Pedido ORD-001",
  },
};

class MemoryInvoiceStore implements InvoiceJobStore {
  issue: IssueLoad = { kind: "ready", payload, connection: conn };
  poll: PollLoad = { kind: "ready", externalId: "ext-1", connection: conn };
  cancel: CancelLoad = {
    kind: "ready",
    externalId: "ext-1",
    justificativa: "Pedido lançado em duplicidade",
    idempotencyKey: `cancel-${I}-1`,
    connection: conn,
  };
  submitted: { externalId: string; status: string; pollDelay: number }[] = [];
  failed: { code: string; message: string }[] = [];
  cancelFailed: { code: string; message: string }[] = [];
  integrationErrors: string[] = [];
  applied: InvoiceView[] = [];
  appliedStatus = "processing";
  polls: { delay: number; round: number }[] = [];
  async loadIssue() {
    return this.issue;
  }
  async markSubmitted(_r: string, _i: string, externalId: string, status: string, pollDelay: number) {
    this.submitted.push({ externalId, status, pollDelay });
  }
  async markFailed(_r: string, _i: string, code: string, message: string) {
    this.failed.push({ code, message });
  }
  async markIntegrationError(_r: string, message: string) {
    this.integrationErrors.push(message);
  }
  async loadPoll() {
    return this.poll;
  }
  async applyRemote(_r: string, _i: string, view: InvoiceView) {
    this.applied.push(view);
    return { status: this.appliedStatus };
  }
  async schedulePoll(_r: string, _i: string, delay: number, round: number) {
    this.polls.push({ delay, round });
  }
  async loadCancel() {
    return this.cancel;
  }
  async markCancelFailed(_r: string, _i: string, code: string, message: string) {
    this.cancelFailed.push({ code, message });
  }
}

let store: MemoryInvoiceStore;
let gateway: FakeInvoiceGateway;

const ctx = (op: InvoiceJob["op"], extra: Partial<InvoiceJob> = {}, attempt = 1): JobContext<InvoiceJob> => ({
  queue: QUEUES.invoiceJobs,
  msgId: 1,
  payload: { v: 1, restaurantId: R, orderInvoiceId: I, op, ...extra },
  attempt,
  readCount: 1,
  signal: new AbortController().signal,
});

beforeEach(() => {
  store = new MemoryInvoiceStore();
  gateway = new FakeInvoiceGateway();
});

const deps = () => ({ store, gatewayFor: () => gateway });

describe("mt_invoice_jobs issue", () => {
  test("sends the frozen payload with Idempotency-Key = order_invoices.id and queues a poll (FR-124)", async () => {
    const out = await createInvoiceIssueHandler(deps()).run(ctx("issue"));
    expect(out).toEqual({ kind: "ok" });
    expect(gateway.calls).toEqual([{ method: "createInvoice", payload, idempotencyKey: I }]);
    expect(store.submitted).toEqual([{ externalId: "fake-inv-1", status: "queued", pollDelay: 30 }]);
  });

  test("a retry resends the same body with the same key; web-nf replays (ADR-016)", async () => {
    const h = createInvoiceIssueHandler(deps());
    await h.run(ctx("issue"));
    await h.run(ctx("issue", {}, 2));
    expect(gateway.calls.map((c) => (c.method === "createInvoice" ? c.idempotencyKey : ""))).toEqual([I, I]);
    expect(store.submitted.map((s) => s.externalId)).toEqual(["fake-inv-1", "fake-inv-1"]);
  });

  test("an already submitted or gone row is skipped", async () => {
    store.issue = { kind: "skip" };
    expect(await createInvoiceIssueHandler(deps()).run(ctx("issue"))).toEqual({ kind: "ok" });
    expect(gateway.calls).toHaveLength(0);
  });

  test("a missing or invalid frozen payload fails with a field error, no network call (FR-125)", async () => {
    store.issue = { kind: "invalid", reason: "request_payload.reference" };
    const out = await createInvoiceIssueHandler(deps()).run(ctx("issue"));
    expect(out).toEqual({ kind: "fail", errorCode: "invalid_payload" });
    expect(store.failed[0]?.code).toBe("invalid_payload");
    expect(gateway.calls).toHaveLength(0);
  });

  test("no fiscal integration fails the row", async () => {
    store.issue = { kind: "not_configured" };
    const out = await createInvoiceIssueHandler(deps()).run(ctx("issue"));
    expect(out).toEqual({ kind: "fail", errorCode: "fiscal_not_configured" });
    expect(store.failed).toEqual([
      { code: "fiscal_not_configured", message: "Configure a integração fiscal em Configurações." },
    ]);
  });

  test("a timeout or 5xx retries and leaves the row queued (FR-137)", async () => {
    gateway.failNextCreate(GatewayError.timeout());
    expect(await createInvoiceIssueHandler(deps()).run(ctx("issue"))).toEqual({ kind: "retry", errorCode: "timeout" });
    gateway.failNextCreate(GatewayError.http(503));
    expect(await createInvoiceIssueHandler(deps()).run(ctx("issue"))).toEqual({
      kind: "retry",
      errorCode: "upstream_error",
      httpStatus: 503,
    });
    expect(store.failed).toHaveLength(0);
  });

  test("429 retries after Retry-After", async () => {
    gateway.failNextCreate(new GatewayError({ kind: "http", status: 429, code: "rate_limited" }, "x", 7000));
    expect(await createInvoiceIssueHandler(deps()).run(ctx("issue"))).toEqual({
      kind: "retry",
      errorCode: "rate_limited",
      httpStatus: 429,
      retryAfterMs: 7000,
    });
  });

  test("422 validation_failed stores one pt-BR line per detail (08 section 8.2)", async () => {
    gateway.failNextCreate(
      new GatewayError({ kind: "http", status: 422, code: "validation_failed" }, "x", undefined, [
        { path: "nfce.itens[0].ncm", code: "invalid_format", message: "NCM must have 8 digits." },
        { path: "nfce.destinatario.cpf", code: "invalid", message: "bad" },
      ]),
    );
    const out = await createInvoiceIssueHandler(deps()).run(ctx("issue"));
    expect(out).toEqual({ kind: "fail", errorCode: "validation_failed", httpStatus: 422 });
    expect(store.failed).toEqual([
      {
        code: "validation_failed",
        message:
          "Dados da nota inválidos: NCM do item «Marmita de frango (Grande)» deve ter 8 dígitos. CPF/CNPJ do cliente inválido.",
      },
    ]);
  });

  test("422 csc_missing stores the 8.1 text", async () => {
    gateway.failNextCreate(GatewayError.http(422, "csc_missing"));
    await createInvoiceIssueHandler(deps()).run(ctx("issue"));
    expect(store.failed[0]).toEqual({
      code: "csc_missing",
      message: "O CSC da NFC-e não está cadastrado para este ambiente (homologação ou produção).",
    });
  });

  test("401 fails the row and marks the integration error", async () => {
    gateway.failNextCreate(GatewayError.http(401, "unauthorized"));
    await createInvoiceIssueHandler(deps()).run(ctx("issue"));
    expect(store.failed[0]?.code).toBe("unauthorized");
    expect(store.integrationErrors).toHaveLength(1);
  });

  test("after the last transport retry the row is failed as ambiguous: web-nf may hold the invoice", async () => {
    await createInvoiceIssueHandler(deps()).onExhausted?.(ctx("issue", {}, 6), { errorCode: "timeout" });
    expect(store.failed).toEqual([{ code: "ambiguous", message: "O serviço fiscal não respondeu." }]);
  });

  test("a definitive refusal keeps its specific code, so a new row is allowed", async () => {
    gateway.failNextCreate(GatewayError.http(422, "certificate_missing"));
    await createInvoiceIssueHandler(deps()).run(ctx("issue"));
    expect(store.failed[0]?.code).toBe("certificate_missing");
  });
});

describe("mt_invoice_jobs poll (FR-127)", () => {
  test("applies the remote state; a non-final state reschedules with backoff", async () => {
    const { id } = await gateway.createInvoice(payload, I);
    store.poll = { kind: "ready", externalId: id, connection: conn };
    const out = await createInvoicePollHandler(deps()).run(ctx("poll", { pollRound: 2 }));
    expect(out).toEqual({ kind: "ok" });
    expect(store.applied[0]?.id).toBe(id);
    expect(store.polls).toEqual([{ delay: pollDelaySeconds(2), round: 3 }]);
  });

  test("a final state stops the chain", async () => {
    const { id } = await gateway.createInvoice(payload, I);
    gateway.authorize(id);
    store.poll = { kind: "ready", externalId: id, connection: conn };
    store.appliedStatus = "authorized";
    await createInvoicePollHandler(deps()).run(ctx("poll"));
    expect(store.polls).toHaveLength(0);
  });

  test("the chain stops after MAX_POLL_ROUNDS; the cron keeps the row covered", async () => {
    const { id } = await gateway.createInvoice(payload, I);
    store.poll = { kind: "ready", externalId: id, connection: conn };
    await createInvoicePollHandler(deps()).run(ctx("poll", { pollRound: MAX_POLL_ROUNDS }));
    expect(store.polls).toHaveLength(0);
  });

  test("backoff doubles from 30 s and caps at 10 minutes", () => {
    expect([0, 1, 2, 3, 4, 5, 10].map(pollDelaySeconds)).toEqual([30, 60, 120, 240, 480, 600, 600]);
  });

  test("a row that is final, gone, or not yet sent is skipped", async () => {
    store.poll = { kind: "skip" };
    expect(await createInvoicePollHandler(deps()).run(ctx("poll"))).toEqual({ kind: "ok" });
    expect(gateway.calls).toHaveLength(0);
  });

  test("a transient error retries", async () => {
    store.poll = { kind: "ready", externalId: "missing", connection: conn };
    const g = new FakeInvoiceGateway();
    g.getInvoice = async () => {
      throw GatewayError.connection();
    };
    const out = await createInvoicePollHandler({ store, gatewayFor: () => g }).run(ctx("poll"));
    expect(out).toEqual({ kind: "retry", errorCode: "connection_error" });
  });

  test("404 marks the row failed", async () => {
    store.poll = { kind: "ready", externalId: "missing", connection: conn };
    const out = await createInvoicePollHandler(deps()).run(ctx("poll"));
    expect(out).toEqual({ kind: "fail", errorCode: "not_found", httpStatus: 404 });
    expect(store.failed).toEqual([{ code: "not_found", message: "Nota não encontrada no serviço fiscal." }]);
  });
});

describe("mt_invoice_jobs cancel (FR-130)", () => {
  test("posts the cancelamento event with its own key and polls for the outcome", async () => {
    const { id } = await gateway.createInvoice(payload, I);
    gateway.authorize(id);
    store.cancel = { ...(store.cancel as Extract<CancelLoad, { kind: "ready" }>), externalId: id };
    const out = await createInvoiceCancelHandler(deps()).run(ctx("cancel"));
    expect(out).toEqual({ kind: "ok" });
    expect(gateway.calls.at(-1)).toEqual({
      method: "cancelInvoice",
      id,
      justificativa: "Pedido lançado em duplicidade",
      idempotencyKey: `cancel-${I}-1`,
    });
    expect(store.polls).toEqual([{ delay: 30, round: 0 }]);
  });

  test("nothing to cancel is skipped", async () => {
    store.cancel = { kind: "skip" };
    expect(await createInvoiceCancelHandler(deps()).run(ctx("cancel"))).toEqual({ kind: "ok" });
  });

  test("409 conflict records a cancel error and frees the request", async () => {
    const { id } = await gateway.createInvoice(payload, I);
    store.cancel = { ...(store.cancel as Extract<CancelLoad, { kind: "ready" }>), externalId: id };
    const out = await createInvoiceCancelHandler(deps()).run(ctx("cancel"));
    expect(out).toEqual({ kind: "fail", errorCode: "conflict", httpStatus: 409 });
    expect(store.cancelFailed).toEqual([
      { code: "conflict", message: "A nota não está em um estado que permita esta ação." },
    ]);
  });

  test("a 5xx retries", async () => {
    const g = new FakeInvoiceGateway();
    g.cancelInvoice = async () => {
      throw GatewayError.http(502);
    };
    const out = await createInvoiceCancelHandler({ store, gatewayFor: () => g }).run(ctx("cancel"));
    expect(out).toEqual({ kind: "retry", errorCode: "upstream_error", httpStatus: 502 });
  });

  test("after the last retry the cancel request is freed with the plain-language text", async () => {
    await createInvoiceCancelHandler(deps()).onExhausted?.(ctx("cancel", {}, 6), { errorCode: "timeout" });
    expect(store.cancelFailed).toEqual([{ code: "timeout", message: "O serviço fiscal não respondeu." }]);
  });
});
