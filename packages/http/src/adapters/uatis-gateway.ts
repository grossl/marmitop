// packages/http/src/adapters/uatis-gateway.ts
//
// UatisGateway: the WhatsAppGateway port over backend-uatis HTTP (ADR-002 and
// Amendments 1-2, ADR-014, ADR-017 #4; FR-100, FR-101, FR-107). Every call goes
// through `safeFetch` (SSRF guard, 10 s timeout, no redirects).
//
// Routes (backend-uatis docs/06.api-spec.md, packages/http/src/routes):
//   POST /v1/messages             send text or template, 201 { id, status: { state } }
//   GET  /v1/messages             { data, next_cursor }, newest first
//   GET  /v1/templates/approved   { data: [{ name, language, ... }], next_cursor }
//
// Failures throw GatewayError. The worker classifies them with
// `classifyOutboundSend` (sends) or `classifyUpstreamFailure` (reads).

import {
  type ApprovedTemplate,
  buildUatisSendTemplateBody,
  buildUatisSendTextBody,
  type ConnectionCheck,
  GatewayError,
  type GatewayMessage,
  type ListMessagesInput,
  type ListMessagesResult,
  parseUatisSendResponse,
  type SendResult,
  type SendTemplateInput,
  type SendTextInput,
  tryMapUatisMessage,
  type WhatsAppGateway,
} from "@mt/core";

import type { SafeFetch, SafeResponse } from "./safe-fetch";

export interface UatisGatewayOptions {
  /** The restaurant's backend-uatis origin (`integrations_whatsapp.base_url`). */
  readonly baseUrl: string;
  /** The unsealed `obk_...` key. Never logged. */
  readonly apiKey: string;
  readonly fetch: SafeFetch;
}

/** backend-uatis `MAX_PAGE_LIMIT`. */
const MAX_LIMIT = 100;

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

function retryAfterMs(res: SafeResponse): number | undefined {
  const value = res.headers["retry-after"];
  if (value === undefined) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

/** A non-2xx answer as a GatewayError with the backend-uatis error code, when it sent one. */
function httpError(res: SafeResponse): GatewayError {
  const parsed = parseJson(res.body);
  const code =
    isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.code === "string" ? parsed.error.code : undefined;
  return new GatewayError(
    { kind: "http", status: res.status, ...(code ? { code } : {}) },
    `backend-uatis answered HTTP ${res.status}${code ? ` (${code})` : ""}`,
    retryAfterMs(res),
  );
}

/** Allow-listed pt-BR text for Settings (FR-086, NFR-011). Never the remote's own message. */
function connectionError(e: unknown): string {
  if (!(e instanceof GatewayError)) return "Não foi possível acessar o backend-uatis.";
  const f = e.failure;
  if (f.kind === "refused") return "Endereço do backend-uatis não permitido.";
  if (f.kind === "http" && (f.status === 401 || f.status === 403))
    return "A chave de API foi recusada pelo backend-uatis.";
  if (f.kind === "http") return `O backend-uatis respondeu com erro (HTTP ${f.status}).`;
  if (f.kind === "timeout") return "O backend-uatis não respondeu a tempo.";
  return "Não foi possível conectar ao backend-uatis.";
}

export class UatisGateway implements WhatsAppGateway {
  private readonly base: string;
  private readonly apiKey: string;
  private readonly fetch: SafeFetch;

  constructor(options: UatisGatewayOptions) {
    this.base = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetch = options.fetch;
  }

  private headers(json: boolean): Record<string, string> {
    return {
      authorization: `Bearer ${this.apiKey}`,
      accept: "application/json",
      "user-agent": "Marmitop/1",
      ...(json ? { "content-type": "application/json" } : {}),
    };
  }

  private async get(path: string, query: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams(query).toString();
    const res = await this.fetch({
      method: "GET",
      url: `${this.base}${path}${qs ? `?${qs}` : ""}`,
      headers: this.headers(false),
    });
    if (res.status < 200 || res.status >= 300) throw httpError(res);
    const parsed = parseJson(res.body);
    if (parsed === undefined) throw GatewayError.network();
    return parsed;
  }

  private async send(body: unknown): Promise<SendResult> {
    const res = await this.fetch({
      method: "POST",
      url: `${this.base}/v1/messages`,
      headers: this.headers(true),
      body: JSON.stringify(body),
    });
    if (res.status < 200 || res.status >= 300) throw httpError(res);
    try {
      return parseUatisSendResponse(parseJson(res.body));
    } catch {
      // A 2xx we cannot read: the message may exist. Ambiguous, never retried (ADR-017).
      throw new GatewayError({ kind: "network_error" }, "backend-uatis returned an unreadable send response");
    }
  }

  sendText(input: SendTextInput): Promise<SendResult> {
    return this.send(buildUatisSendTextBody(input));
  }

  sendTemplate(input: SendTemplateInput): Promise<SendResult> {
    return this.send(buildUatisSendTemplateBody(input));
  }

  async listMessages(input: ListMessagesInput = {}): Promise<ListMessagesResult> {
    const query: Record<string, string> = {};
    if (input.direction) query.direction = input.direction;
    if (input.from) query.from = input.from.toISOString();
    if (input.cursor) query.cursor = input.cursor;
    if (input.limit !== undefined) query.limit = String(Math.min(MAX_LIMIT, Math.max(1, input.limit)));
    const page = await this.get("/v1/messages", query);
    if (!isRecord(page) || !Array.isArray(page.data)) throw GatewayError.network();
    const items: GatewayMessage[] = [];
    for (const raw of page.data) {
      const m = tryMapUatisMessage(raw);
      if (m) items.push(m);
    }
    return { items, nextCursor: typeof page.next_cursor === "string" ? page.next_cursor : null };
  }

  async listApprovedTemplates(): Promise<readonly ApprovedTemplate[]> {
    const page = await this.get("/v1/templates/approved", { limit: String(MAX_LIMIT) });
    if (!isRecord(page) || !Array.isArray(page.data)) throw GatewayError.network();
    return page.data
      .filter(isRecord)
      .filter((t) => typeof t.name === "string" && typeof t.language === "string")
      .map((t) => ({ name: t.name as string, language: t.language as string }));
  }

  /** FR-086: one cheap authenticated read proves the base URL and the key. */
  async testConnection(): Promise<ConnectionCheck> {
    try {
      await this.get("/v1/messages", { limit: "1" });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: connectionError(e) };
    }
  }
}
