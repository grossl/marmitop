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
//   GET  /v1/organizations/current            { id, name, slug, role, created_at }       (ADR-021)
//   POST /v1/webhooks                         201 { id, url, events, status, ..., secret }
//   GET  /v1/webhooks/{id}                    { id, mode, url, events, status, ... }, or 404
//   DELETE /v1/webhooks/{id}                  204, or 404 not_found
//   GET  /v1/webhooks/{id}/deliveries?limit=  { data: Delivery[], next_cursor }, newest first
//   GET  /v1/webhooks/{id}/events?after&limit { data: [{ cursor, id, type, created_at, organization_id, data }],
//                                             next_cursor }, oldest first; 410 cursor_expired; 404 (ADR-023)
//
// Failures throw GatewayError. The worker classifies them with
// `classifyOutboundSend` (sends) or `classifyUpstreamFailure` (reads).

import {
  type ApprovedTemplate,
  buildUatisSendTemplateBody,
  buildUatisSendTextBody,
  type ConnectionCheck,
  type CreatedUatisWebhook,
  type CreateWebhookInput,
  GatewayError,
  type GatewayMessage,
  type ListMessagesInput,
  type ListMessagesResult,
  parseUatisSendResponse,
  type SendResult,
  type SendTemplateInput,
  type SendTextInput,
  tryMapUatisMessage,
  type UatisFeedEvent,
  type UatisFeedPage,
  type UatisOrganization,
  type UatisWebhookDelivery,
  type UatisWebhookInfo,
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

  /** A JSON call other than a send. Non-2xx throws; an unreadable 2xx is a network error. */
  private async call(method: "POST" | "DELETE", path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
    const res = await this.fetch({
      method,
      url: `${this.base}${path}`,
      headers: this.headers(body !== undefined),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status < 200 || res.status >= 300) throw httpError(res);
    if (res.status === 204 || res.body === "") return { status: res.status, json: null };
    const parsed = parseJson(res.body);
    if (parsed === undefined) throw GatewayError.network();
    return { status: res.status, json: parsed };
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

  async getOrganization(): Promise<UatisOrganization> {
    const org = await this.get("/v1/organizations/current", {});
    if (!isRecord(org) || typeof org.id !== "string" || org.id === "") throw GatewayError.network();
    return { id: org.id, name: typeof org.name === "string" ? org.name : "" };
  }

  async createWebhook(input: CreateWebhookInput): Promise<CreatedUatisWebhook> {
    // A pull webhook sends no `url` at all (ADR-023): backend-uatis validates a present url.
    const body =
      input.mode === "push"
        ? { mode: "push", url: input.url, events: input.events, description: input.description }
        : { mode: "pull", events: input.events, description: input.description };
    const { json } = await this.call("POST", "/v1/webhooks", body);
    if (!isRecord(json) || typeof json.id !== "string") throw GatewayError.network();
    const secret = typeof json.secret === "string" && json.secret !== "" ? json.secret : null;
    // A push webhook without its one-time secret could never be verified: treat it as unreadable.
    if (input.mode === "push" && secret === null) throw GatewayError.network();
    return {
      id: json.id,
      mode: json.mode === "pull" || json.mode === "push" ? json.mode : input.mode,
      url: typeof json.url === "string" ? json.url : null,
      events: Array.isArray(json.events) ? json.events.filter((e): e is string => typeof e === "string") : [],
      status: json.status === "disabled" ? "disabled" : "active",
      secret,
    };
  }

  async getWebhook(webhookId: string): Promise<UatisWebhookInfo | null> {
    let json: unknown;
    try {
      json = await this.get(`/v1/webhooks/${encodeURIComponent(webhookId)}`, {});
    } catch (e) {
      if (e instanceof GatewayError && e.failure.kind === "http" && e.failure.status === 404) return null;
      throw e;
    }
    if (!isRecord(json) || typeof json.id !== "string") throw GatewayError.network();
    return {
      id: json.id,
      // A backend-uatis without modes has push webhooks only.
      mode: json.mode === "pull" ? "pull" : "push",
      url: typeof json.url === "string" ? json.url : null,
      status: json.status === "disabled" ? "disabled" : "active",
    };
  }

  async deleteWebhook(webhookId: string): Promise<{ deleted: boolean }> {
    try {
      await this.call("DELETE", `/v1/webhooks/${encodeURIComponent(webhookId)}`);
      return { deleted: true };
    } catch (e) {
      if (e instanceof GatewayError && e.failure.kind === "http" && e.failure.status === 404) return { deleted: false };
      throw e;
    }
  }

  async listWebhookDeliveries(
    webhookId: string,
    options: { readonly limit?: number } = {},
  ): Promise<readonly UatisWebhookDelivery[]> {
    const limit = String(Math.min(MAX_LIMIT, Math.max(1, options.limit ?? 50)));
    const page = await this.get(`/v1/webhooks/${encodeURIComponent(webhookId)}/deliveries`, { limit });
    if (!isRecord(page) || !Array.isArray(page.data)) throw GatewayError.network();
    return page.data.filter(isRecord).flatMap((d) => {
      const createdAt = typeof d.created_at === "string" ? new Date(d.created_at) : null;
      if (typeof d.id !== "string" || !createdAt || Number.isNaN(createdAt.getTime())) return [];
      const status = DELIVERY_STATUSES.find((s) => s === d.status);
      if (status === undefined) return [];
      const deliveredAt = typeof d.delivered_at === "string" ? new Date(d.delivered_at) : null;
      return [
        {
          id: d.id,
          eventType: typeof d.event_type === "string" ? d.event_type : "",
          status,
          attemptNo: typeof d.attempt_no === "number" ? d.attempt_no : 1,
          httpStatus: typeof d.http_status === "number" ? d.http_status : null,
          durationMs: typeof d.duration_ms === "number" ? d.duration_ms : null,
          createdAt,
          deliveredAt: deliveredAt && !Number.isNaN(deliveredAt.getTime()) ? deliveredAt : null,
        },
      ];
    });
  }

  async listWebhookEvents(
    webhookId: string,
    options: { readonly after: string | null; readonly limit?: number },
  ): Promise<UatisFeedPage> {
    const query: Record<string, string> = { limit: String(Math.min(MAX_LIMIT, Math.max(1, options.limit ?? 50))) };
    if (options.after !== null) query.after = options.after;
    const page = await this.get(`/v1/webhooks/${encodeURIComponent(webhookId)}/events`, query);
    if (!isRecord(page) || !Array.isArray(page.data)) throw GatewayError.network();
    const events: UatisFeedEvent[] = [];
    for (const raw of page.data) {
      const e = toFeedEvent(raw);
      if (e === null) throw GatewayError.network();
      events.push(e);
    }
    return { events, nextCursor: typeof page.next_cursor === "string" ? page.next_cursor : null };
  }
}

/** Feed item: the envelope without `cursor`, so it equals the push body (ADR-023). */
function toFeedEvent(raw: unknown): UatisFeedEvent | null {
  if (!isRecord(raw) || typeof raw.cursor !== "string" || raw.cursor === "") return null;
  const { cursor, ...event } = raw;
  return { cursor, event };
}

const DELIVERY_STATUSES = ["pending", "delivered", "failed", "exhausted"] as const;
