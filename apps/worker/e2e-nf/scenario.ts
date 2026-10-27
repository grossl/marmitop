// The NF_E2E scenario (10.testing.md "web-nf (homologação)"), shared by the gated script
// `issue-nfce.ts` (real web-nf) and the dry run in `src/e2e-nf.dry-run.test.ts`
// (FakeWebNfServer). It drives the real WebNfGateway only. It prints ids and states,
// never the API key or a signed URL (FR-138).
//
// Steps: testConnection → build an NFC-e from a fixture order (core buildInvoiceRequest)
// → POST /v1/invoices → replay with the same key and body (Idempotency-Replayed) → poll
// GET /v1/invoices/{id} to a final state → on authorized: files and cancel; on rejected or
// failed: check the error maps to a pt-BR hint (08 section 8.3).

import { randomUUID } from "node:crypto";

import {
  buildInvoiceRequest,
  FINAL_INVOICE_STATUSES,
  type InvoiceGateway,
  invoiceErrorText,
  type InvoiceView,
} from "@mt/core";

export interface StepResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface ScenarioOptions {
  /** How long to wait for a final state. */
  readonly timeoutMs: number;
  readonly pollEveryMs: number;
  /** Called between polls; the dry run uses it to move the fake invoice forward. */
  readonly onPoll?: (invoiceId: string, round: number) => void | Promise<void>;
  /** Before the cancel's outcome is read. */
  readonly onCancel?: (invoiceId: string) => void | Promise<void>;
}

/** A pickup order of one meal, paid with Pix: the smallest valid NFC-e. */
export function fixtureRequest(reference: string) {
  const built = buildInvoiceRequest(
    {
      code: "ORD-E2E",
      status: "finalizado",
      fulfillment: "pickup",
      paymentMethod: "pix",
      changeForCents: null,
      deliveryFeeCents: 0,
      totalCents: 2590,
    },
    [
      {
        menuItemId: "0d9e2b34-5c11-4e7a-8d2f-6a5b9c0e1f22",
        name: "Marmita de frango",
        sizeName: "Grande",
        unitPriceCents: 2590,
        qty: 1,
      },
    ],
    { name: "Consumidor", cpfCnpj: null },
    {
      baseUrl: "set",
      apiKeyConfigured: true,
      nfceSerie: 1,
      nfeSerie: 1,
      defaultNcm: "21069090",
      defaultCfop: "5101",
      defaultCsosn: "102",
      defaultPisCst: "49",
      defaultCofinsCst: "49",
      deliveryFeeMode: "item",
    },
    [{ id: "0d9e2b34-5c11-4e7a-8d2f-6a5b9c0e1f22", kind: "meal", ncm: null, cfop: null }],
    "nfce",
    { reference },
  );
  if (!built.ok) throw new Error(`fixture does not build: ${JSON.stringify(built.problems)}`);
  return built.request;
}

const final = (s: string) => (FINAL_INVOICE_STATUSES as readonly string[]).includes(s);

export async function runNfScenario(gateway: InvoiceGateway, options: ScenarioOptions): Promise<StepResult[]> {
  const steps: StepResult[] = [];
  const step = (name: string, ok: boolean, detail = "") => steps.push({ name, ok, detail });

  const conn = await gateway.testConnection();
  step("testConnection", conn.ok, conn.ok ? "" : conn.error);
  if (!conn.ok) return steps;

  const key = randomUUID();
  const body = fixtureRequest(key);
  const created = await gateway.createInvoice(body, key);
  step(
    "POST /v1/invoices 202",
    !created.replayed && ["received", "queued", "processing"].includes(created.status),
    `id=${created.id} status=${created.status}`,
  );
  const replay = await gateway.createInvoice(body, key);
  step("replay with the same key", replay.replayed && replay.id === created.id, `replayed=${replay.replayed}`);

  let view: InvoiceView = await gateway.getInvoice(created.id);
  const deadline = Date.now() + options.timeoutMs;
  let round = 0;
  while (!final(view.status) && Date.now() < deadline) {
    await options.onPoll?.(created.id, round++);
    await Bun.sleep(options.pollEveryMs);
    view = await gateway.getInvoice(created.id);
  }
  step("final state reached", final(view.status), `status=${view.status}`);

  if (view.status === "authorized") {
    step("numero and chave", view.numero !== null && (view.chaveAcesso?.length ?? 0) === 44, `numero=${view.numero}`);
    step("XML URL present", !!view.files?.xml, view.files?.pdf ? "pdf present" : "pdf missing (08 Q4)");
    const cancel = await gateway.cancelInvoice(created.id, "Teste de integração Marmitop (homologação)", randomUUID());
    step(
      "cancel event accepted",
      ["queued", "processing", "authorized"].includes(cancel.status),
      `event=${cancel.status}`,
    );
    await options.onCancel?.(created.id);
    const after = await gateway.getInvoice(created.id);
    const event = [...(after.events ?? [])].reverse().find((e) => e.type === "cancelamento");
    step("cancel event visible", event !== undefined, `invoice=${after.status} event=${event?.status ?? "none"}`);
  } else if (final(view.status)) {
    const text = invoiceErrorText({
      status: view.status,
      errorCode: view.error?.code ?? null,
      errorMessage: view.error?.message ?? null,
    });
    step("error maps to a pt-BR hint", text !== null, `code=${view.error?.code ?? "none"}`);
  }
  return steps;
}
