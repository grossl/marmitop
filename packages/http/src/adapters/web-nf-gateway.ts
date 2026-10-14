// packages/http/src/adapters/web-nf-gateway.ts
//
// WebNfGateway: the InvoiceGateway port over the web-nf generation API (ADR-003,
// 08.fiscal-mapping.md section 6; FR-124, FR-127, FR-129, FR-130, FR-137, FR-138).
// Every call goes through `safeFetch` (SSRF guard, 10 s timeout, no redirects).
//
// Routes (web-nf docs/06.api-spec.md, apps/generation-api/src/app.ts):
//   POST /v1/invoices                202 { id, status: "queued", kind }; header Idempotency-Replayed: true on a replay
//   GET  /v1/invoices/{id}           200 { id, kind, status, numero, serie, chave_acesso, error, files, events, authorized_at, ... }
//   POST /v1/invoices/{id}/events    202 { id, status: "queued" } (the event, not the invoice)
//
// Failures throw GatewayError with web-nf's `error.code` and `details[]`. The worker
// classifies them with `classifyUpstreamFailure`: every call is safe to retry, because
// POSTs carry an Idempotency-Key bound to the exact body (08 section 6).
//
// Never logs: the API key and the signed file URLs stay in local values (FR-138).

import {
  type CancelInvoiceResult,
  type ConnectionCheck,
  type CreateInvoiceResult,
  GatewayError,
  type GatewayErrorDetail,
  type InvoiceGateway,
  type InvoiceKind,
  type InvoiceRequestBody,
  type InvoiceStatusValue,
  type InvoiceView,
} from "@mt/core";

import type { SafeFetch, SafeResponse } from "./safe-fetch";

export interface WebNfGatewayOptions {
  /** The restaurant's web-nf origin (`integrations_fiscal.base_url`). */
  readonly baseUrl: string;
  /** The unsealed `nfk_test_`/`nfk_live_` key. Never logged. */
  readonly apiKey: string;
  readonly fetch: SafeFetch;
}

/** A syntactically valid id no invoice has: the connection test reads it and expects 404. */
const PROBE_ID = "00000000-0000-4000-8000-000000000000";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);

function retryAfterMs(res: SafeResponse): number | undefined {
  const value = res.headers["retry-after"];
  if (value === undefined) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

function readDetails(v: unknown): GatewayErrorDetail[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .filter(isRecord)
    .map((d) => ({ path: str(d.path) ?? "", code: str(d.code) ?? "invalid", message: str(d.message) ?? "" }));
  return out.length > 0 ? out : undefined;
}

/** A non-2xx answer as a GatewayError with web-nf's error code and details. */
function httpError(res: SafeResponse): GatewayError {
  const parsed = parseJson(res.body);
  const err = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : null;
  const code = err ? (str(err.code) ?? undefined) : undefined;
  return new GatewayError(
    { kind: "http", status: res.status, ...(code ? { code } : {}) },
    `web-nf answered HTTP ${res.status}${code ? ` (${code})` : ""}`,
    retryAfterMs(res),
    err ? readDetails(err.details) : undefined,
  );
}

/** web-nf returns `serie` as a number, or as text for an alphanumeric RPS series. Marmitop stores int only. */
function serieOf(v: unknown): number | null {
  if (typeof v === "number" && Number.isSafeInteger(v)) return v;
  if (typeof v === "string" && /^\d{1,9}$/.test(v)) return Number(v);
  return null;
}

function errorOf(v: unknown): { code: string; message: string } | null {
  if (!isRecord(v)) return null;
  const code = typeof v.code === "number" ? String(v.code) : str(v.code);
  if (!code) return null;
  return { code, message: str(v.message) ?? "" };
}

function toView(raw: unknown): InvoiceView {
  if (!isRecord(raw)) throw GatewayError.network();
  const id = str(raw.id);
  const kind = str(raw.kind);
  const status = str(raw.status);
  if (!id || !kind || !status) throw GatewayError.network();
  const files = isRecord(raw.files) ? raw.files : null;
  const xml = files ? str(files.xml) : null;
  const pdf = files ? str(files.pdf) : null;
  const events = Array.isArray(raw.events)
    ? raw.events.filter(isRecord).map((e) => ({
        type: str(e.type) ?? "",
        status: str(e.status) ?? "",
        error: errorOf(e.error),
      }))
    : [];
  return {
    id,
    kind: kind as InvoiceKind,
    status,
    numero: int(raw.numero),
    serie: serieOf(raw.serie),
    chaveAcesso: str(raw.chave_acesso),
    error: errorOf(raw.error),
    files: files ? { ...(xml ? { xml } : {}), ...(pdf ? { pdf } : {}) } : null,
    authorizedAt: str(raw.authorized_at),
    events,
  };
}

/** Allow-listed pt-BR text for Settings (FR-091, NFR-011). Never the remote's own message. */
function connectionError(e: unknown): string {
  if (!(e instanceof GatewayError)) return "Não foi possível acessar o web-nf.";
  const f = e.failure;
  if (f.kind === "refused") return "Endereço do web-nf não permitido.";
  if (f.kind === "http" && (f.status === 401 || f.status === 403)) return "A chave de API foi recusada pelo web-nf.";
  if (f.kind === "http") return `O web-nf respondeu com erro (HTTP ${f.status}).`;
  if (f.kind === "timeout") return "O web-nf não respondeu a tempo.";
  return "Não foi possível conectar ao web-nf.";
}

export class WebNfGateway implements InvoiceGateway {
  private readonly base: string;
  private readonly apiKey: string;
  private readonly fetch: SafeFetch;

  constructor(options: WebNfGatewayOptions) {
    this.base = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetch = options.fetch;
  }

  private headers(idempotencyKey?: string): Record<string, string> {
    return {
      authorization: `Bearer ${this.apiKey}`,
      accept: "application/json",
      "user-agent": "Marmitop/1",
      ...(idempotencyKey !== undefined
        ? { "content-type": "application/json", "idempotency-key": idempotencyKey }
        : {}),
    };
  }

  private invoiceUrl(id: string): string {
    return `${this.base}/v1/invoices/${encodeURIComponent(id)}`;
  }

  /** POST with a key. A 2xx we cannot read is a network error: the retry replays with the same key. */
  private async post(
    url: string,
    body: string,
    idempotencyKey: string,
  ): Promise<{ res: SafeResponse; json: Record<string, unknown> }> {
    const res = await this.fetch({ method: "POST", url, headers: this.headers(idempotencyKey), body });
    if (res.status < 200 || res.status >= 300) throw httpError(res);
    const json = parseJson(res.body);
    if (!isRecord(json)) throw new GatewayError({ kind: "network_error" }, "web-nf returned an unreadable response");
    return { res, json };
  }

  async createInvoice(payload: InvoiceRequestBody, idempotencyKey: string): Promise<CreateInvoiceResult> {
    const { res, json } = await this.post(`${this.base}/v1/invoices`, JSON.stringify(payload), idempotencyKey);
    const id = str(json.id);
    const status = str(json.status);
    if (!id || !status) throw new GatewayError({ kind: "network_error" }, "web-nf returned an unreadable response");
    return {
      id,
      status: status as InvoiceStatusValue,
      replayed: res.headers["idempotency-replayed"] === "true",
    };
  }

  async getInvoice(id: string): Promise<InvoiceView> {
    const res = await this.fetch({ method: "GET", url: this.invoiceUrl(id), headers: this.headers() });
    if (res.status < 200 || res.status >= 300) throw httpError(res);
    return toView(parseJson(res.body));
  }

  async cancelInvoice(id: string, justificativa: string, idempotencyKey: string): Promise<CancelInvoiceResult> {
    const { json } = await this.post(
      `${this.invoiceUrl(id)}/events`,
      JSON.stringify({ type: "cancelamento", justificativa }),
      idempotencyKey,
    );
    return { status: str(json.status) ?? "queued" };
  }

  /**
   * FR-091: one authenticated read proves the base URL and the key. The generation API has no
   * list route, so it reads an id that cannot exist: `404 not_found` means the key passed auth.
   */
  async testConnection(): Promise<ConnectionCheck> {
    try {
      await this.getInvoice(PROBE_ID);
      return { ok: true };
    } catch (e) {
      if (e instanceof GatewayError && e.failure.kind === "http" && e.failure.status === 404) return { ok: true };
      return { ok: false, error: connectionError(e) };
    }
  }
}
