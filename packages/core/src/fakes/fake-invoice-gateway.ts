// FakeInvoiceGateway: in-memory InvoiceGateway (FR-124). It mirrors web-nf's Idempotency-Key
// rules: the same key with the same body replays; the same key with another body is a 409.

import type { InvoiceRequestBody } from "../fiscal/invoice-request";
import { GatewayError } from "../ports/gateway-error";
import type { CancelInvoiceResult, CreateInvoiceResult, InvoiceGateway, InvoiceView } from "../ports/invoice-gateway";

export interface ScriptedCreate {
  readonly result?: Partial<Pick<CreateInvoiceResult, "id" | "status">>;
  readonly error?: Error;
  readonly delayMs?: number;
}

export type InvoiceCall =
  | { readonly method: "createInvoice"; readonly payload: InvoiceRequestBody; readonly idempotencyKey: string }
  | { readonly method: "getInvoice"; readonly id: string }
  | {
      readonly method: "cancelInvoice";
      readonly id: string;
      readonly justificativa: string;
      readonly idempotencyKey: string;
    }
  | { readonly method: "testConnection" };

interface Stored {
  view: InvoiceView;
  key: string;
  bodyJson: string;
}

export class FakeInvoiceGateway implements InvoiceGateway {
  readonly calls: InvoiceCall[] = [];
  private readonly invoices = new Map<string, Stored>();
  private readonly byKey = new Map<string, Stored>();
  private readonly scripted: ScriptedCreate[] = [];
  private connection: { ok: true } | { ok: false; error: string } = { ok: true };
  private nextId = 1;

  scriptNextCreate(script: ScriptedCreate): this {
    this.scripted.push(script);
    return this;
  }

  failNextCreate(error: Error): this {
    return this.scriptNextCreate({ error });
  }

  setConnection(check: { ok: true } | { ok: false; error: string }): this {
    this.connection = check;
    return this;
  }

  /** Move an invoice to a new state, as web-nf would after SEFAZ answers. */
  update(id: string, patch: Partial<Omit<InvoiceView, "id" | "kind">>): InvoiceView {
    const stored = this.invoices.get(id);
    if (!stored) throw new Error(`FakeInvoiceGateway: no invoice ${id}`);
    stored.view = { ...stored.view, ...patch };
    return stored.view;
  }

  authorize(id: string, fields: { numero?: number; serie?: number; chaveAcesso?: string } = {}): InvoiceView {
    return this.update(id, {
      status: "authorized",
      numero: fields.numero ?? 1,
      serie: fields.serie ?? 1,
      chaveAcesso: fields.chaveAcesso ?? "4".repeat(44),
      error: null,
      files: { xml: `https://files.fake/${id}.xml`, pdf: `https://files.fake/${id}.pdf` },
    });
  }

  async createInvoice(payload: InvoiceRequestBody, idempotencyKey: string): Promise<CreateInvoiceResult> {
    this.calls.push({ method: "createInvoice", payload, idempotencyKey });
    const script = this.scripted.shift();
    if (script?.delayMs) await new Promise((resolve) => setTimeout(resolve, script.delayMs));
    if (script?.error) throw script.error;
    const bodyJson = JSON.stringify(payload);
    const existing = this.byKey.get(idempotencyKey);
    if (existing) {
      if (existing.bodyJson !== bodyJson) {
        throw GatewayError.http(409, "idempotency_conflict", "Idempotency-Key was used with another body");
      }
      return { id: existing.view.id, status: existing.view.status as CreateInvoiceResult["status"], replayed: true };
    }
    const id = script?.result?.id ?? `fake-inv-${this.nextId++}`;
    const status = script?.result?.status ?? "queued";
    const stored: Stored = {
      key: idempotencyKey,
      bodyJson,
      view: { id, kind: payload.kind, status, numero: null, serie: null, chaveAcesso: null, error: null, files: null },
    };
    this.invoices.set(id, stored);
    this.byKey.set(idempotencyKey, stored);
    return { id, status, replayed: false };
  }

  async getInvoice(id: string): Promise<InvoiceView> {
    this.calls.push({ method: "getInvoice", id });
    const stored = this.invoices.get(id);
    if (!stored) throw GatewayError.http(404, "not_found", "Invoice not found");
    return stored.view;
  }

  async cancelInvoice(id: string, justificativa: string, idempotencyKey: string): Promise<CancelInvoiceResult> {
    this.calls.push({ method: "cancelInvoice", id, justificativa, idempotencyKey });
    const stored = this.invoices.get(id);
    if (!stored) throw GatewayError.http(404, "not_found", "Invoice not found");
    if (stored.view.status !== "authorized") {
      throw GatewayError.http(409, "conflict", "Only an authorized invoice can be cancelled");
    }
    if (justificativa.length < 15 || justificativa.length > 255) {
      throw GatewayError.http(422, "validation_failed", "justificativa must have 15 to 255 characters");
    }
    stored.view = { ...stored.view, status: "cancelled" };
    return { status: "cancelled" };
  }

  async testConnection() {
    this.calls.push({ method: "testConnection" });
    return this.connection;
  }
}
