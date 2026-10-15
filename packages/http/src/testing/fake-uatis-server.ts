// A local stand-in for backend-uatis (tests and the gated UATIS_E2E suite's dry run).
// It mimics the routes UatisGateway calls, with the shapes backend-uatis really
// returns (backend-uatis packages/http/src/routes/read.ts, templates.ts,
// services/send.ts, services/mappers.ts):
//
//   POST /v1/messages              201 { id, conversation_id, direction: "out", status: { state: "pending" }, created_at }
//   GET  /v1/messages              200 { data: Message[], next_cursor } newest first, keyset cursor
//   GET  /v1/templates/approved    200 { data: Template[], next_cursor: null }
//   GET  /v1/organizations/current 200 { id, name, slug, role, created_at }          (ADR-021)
//   POST /v1/webhooks              201 { id, url, description, events, status, created_at, updated_at, secret }
//                                  422 validation_failed for a non-default port or a private literal host
//                                  403 forbidden for a key whose role is not admin
//   DELETE /v1/webhooks/{id}       204, or 404 not_found
//   GET  /v1/webhooks/{id}/deliveries  200 { data: Delivery[], next_cursor: null }, newest first
//   GET  /v1/webhooks/{id}/events?after&limit  200 { data: [{ cursor, ...envelope }], next_cursor }, oldest
//                                  first (ADR-023); 404 when `feedSupported` is false (an older backend-uatis)
//
// Every inbound inject, send, and status change writes one event per subscribed webhook,
// push or pull, as `enqueue_webhook_delivery` does. `pushBodies` keeps each rendered body.
//
// `uatisWebhookBody` renders the exact envelope the backend-uatis worker posts
// (its apps/worker/src/body.ts over the `enqueue_webhook_delivery` snapshot).
//
// Stored text content is `{ version: "1", type: "text", kind: "text", text: "<string>" }`.
// Errors use the backend-uatis envelope `{ error: { code, message } }`.

import { randomBytes, randomUUID } from "node:crypto";

import { isBlockedAddress, isBlockedHostname } from "@mt/core";

export interface FakeUatisRow {
  id: string;
  conversation_id: string;
  direction: "in" | "out" | "internal";
  content: Record<string, unknown>;
  status: { state: string; errors: unknown[] };
  external_id: string | null;
  contact_address: string | null;
  created_at: string;
}

export interface FakeUatisWebhook {
  id: string;
  mode: "push" | "pull";
  url: string | null;
  description: string | null;
  events: string[];
  status: "active" | "disabled";
  secret: string | null;
  created_at: string;
  updated_at: string;
}

interface FakeFeedItem {
  readonly webhookId: string;
  readonly cursor: string;
  readonly createdAt: string;
  readonly deliveryId: string;
  readonly body: string;
}

/** backend-uatis `deliverySchema`. */
export interface FakeUatisDelivery {
  id: string;
  webhook_id: string;
  event_type: string;
  resource_type: "message" | "conversation";
  resource_id: string;
  status: "pending" | "delivered" | "failed" | "exhausted";
  attempt_no: number;
  http_status: number | null;
  duration_ms: number | null;
  created_at: string;
  delivered_at: string | null;
}

/**
 * The exact body the backend-uatis worker posts for a message event: `{ id, type, created_at,
 * organization_id, data: { message } }`, where `message` has only the snapshot keys of
 * `public.enqueue_webhook_delivery` and `status` is `{ state, errors }`.
 */
export function uatisWebhookBody(input: {
  readonly type: "message.created" | "message.updated";
  readonly organizationId: string;
  readonly row: Pick<FakeUatisRow, "id" | "conversation_id" | "direction" | "content" | "status" | "contact_address" | "created_at">;
  readonly deliveryId?: string;
  readonly createdAt?: string;
}): string {
  const { row } = input;
  return JSON.stringify({
    id: input.deliveryId ?? randomUUID(),
    type: input.type,
    created_at: input.createdAt ?? new Date().toISOString(),
    organization_id: input.organizationId,
    data: {
      message: {
        id: row.id,
        conversation_id: row.conversation_id,
        direction: row.direction,
        content: row.content,
        status: row.status,
        contact_address: row.contact_address,
        created_at: row.created_at,
      },
    },
  });
}

export interface FakeUatisRequest {
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly authorization: string | null;
  readonly body: unknown;
}

/** One scripted answer for the next matching request. */
export type FakeUatisScript =
  | { readonly kind: "status"; readonly status: number; readonly code?: string; readonly retryAfter?: string }
  /** Hold the answer for `ms`, then answer normally (drives client timeouts). */
  | { readonly kind: "delay"; readonly ms: number }
  /** Answer 2xx with a body that is not JSON. */
  | { readonly kind: "garbage" };

export interface FakeUatisServerOptions {
  readonly apiKey?: string;
  /** Refuse free text without an inbound message from `to` in the last 24 h, like backend-uatis. */
  readonly enforceServiceWindow?: boolean;
}

export class FakeUatisServer {
  readonly apiKey: string;
  readonly requests: FakeUatisRequest[] = [];
  readonly rows: FakeUatisRow[] = [];
  templates: { id: string; name: string; language: string; status: string; category: string }[] = [];
  lineConnected = true;
  readonly organizationId: string = randomUUID();
  /** `api_keys.role` of the key; webhook routes need `admin`. */
  apiKeyRole: "member" | "admin" | "owner" = "admin";
  readonly webhooks = new Map<string, FakeUatisWebhook>();
  readonly deliveries: FakeUatisDelivery[] = [];
  /** Every envelope rendered for a webhook, in order (the bytes a push would carry). */
  readonly pushBodies: string[] = [];
  /** False mimics a backend-uatis without the event feed: `/events` answers 404. */
  feedSupported = true;
  private readonly feed: FakeFeedItem[] = [];
  private readonly scripts: { match: string; script: FakeUatisScript }[] = [];
  private readonly enforceWindow: boolean;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private lastMs = 0;

  constructor(options: FakeUatisServerOptions = {}) {
    this.apiKey = options.apiKey ?? "obk_test_fake";
    this.enforceWindow = options.enforceServiceWindow ?? false;
  }

  start(): this {
    this.server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => this.handle(req) });
    return this;
  }

  get baseUrl(): string {
    if (!this.server) throw new Error("FakeUatisServer is not started");
    return `http://127.0.0.1:${this.server.port}`;
  }

  async stop(): Promise<void> {
    this.server?.stop(true);
    this.server = null;
  }

  /** Script the next request whose `METHOD /path` starts with `match` (for example `POST /v1/messages`). */
  scriptNext(match: string, script: FakeUatisScript): this {
    this.scripts.push({ match, script });
    return this;
  }

  /** A message from the customer, as the Meta ingest stores it. */
  injectInbound(from: string, body: string, at?: Date): FakeUatisRow {
    const row: FakeUatisRow = {
      id: randomUUID(),
      conversation_id: this.conversationFor(from),
      direction: "in",
      content: { version: "1", type: "text", kind: "text", text: body },
      status: { state: "received", errors: [] },
      external_id: `wamid.${randomUUID()}`,
      contact_address: from,
      created_at: this.stamp(at),
    };
    this.rows.push(row);
    this.emit("message.created", row);
    return row;
  }

  /** A status change, as a Meta status webhook applies it: emits `message.updated`. */
  updateStatus(rowId: string, state: string, errors: unknown[] = []): FakeUatisRow {
    const row = this.rows.find((r) => r.id === rowId);
    if (!row) throw new Error(`no row ${rowId}`);
    row.status = { state, errors };
    this.emit("message.updated", row);
    return row;
  }

  private emit(type: "message.created" | "message.updated", row: FakeUatisRow): void {
    if (row.direction === "internal") return;
    for (const hook of this.webhooks.values()) {
      if (!hook.events.includes(type)) continue;
      const deliveryId = randomUUID();
      const createdAt = this.stamp();
      const body = uatisWebhookBody({ type, organizationId: this.organizationId, row, deliveryId, createdAt });
      const cursor = Buffer.from(JSON.stringify({ t: createdAt, id: deliveryId })).toString("base64url");
      this.feed.push({ webhookId: hook.id, cursor, createdAt, deliveryId, body });
      this.pushBodies.push(body);
      this.recordDelivery(hook.id, { id: deliveryId, event_type: type, status: "pending", http_status: null, created_at: createdAt });
    }
  }

  /** Agent tool traffic: never reaches a customer. */
  injectInternal(text: string): FakeUatisRow {
    const row: FakeUatisRow = {
      id: randomUUID(),
      conversation_id: randomUUID(),
      direction: "internal",
      content: { version: "1", type: "text", kind: "text", text },
      status: { state: "pending", errors: [] },
      external_id: null,
      contact_address: null,
      created_at: this.stamp(),
    };
    this.rows.push(row);
    return row;
  }

  private stamp(at?: Date): string {
    if (at) return at.toISOString();
    // Strictly increasing, so newest-first order is stable.
    this.lastMs = Math.max(Date.now(), this.lastMs + 1);
    return new Date(this.lastMs).toISOString();
  }

  private conversationFor(address: string): string {
    return this.rows.find((r) => r.contact_address === address)?.conversation_id ?? randomUUID();
  }

  private takeScript(method: string, path: string): FakeUatisScript | undefined {
    const key = `${method} ${path}`;
    const i = this.scripts.findIndex((s) => key.startsWith(s.match));
    if (i < 0) return undefined;
    const [entry] = this.scripts.splice(i, 1);
    return entry?.script;
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const text = req.method === "POST" || req.method === "PATCH" ? await req.text() : "";
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    this.requests.push({
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      authorization: req.headers.get("authorization"),
      body,
    });

    const script = this.takeScript(req.method, url.pathname);
    if (script?.kind === "delay") await Bun.sleep(script.ms);
    if (script?.kind === "status") {
      return Response.json(
        { error: { code: script.code ?? "internal_error", message: "scripted" } },
        { status: script.status, headers: script.retryAfter ? { "retry-after": script.retryAfter } : {} },
      );
    }
    if (script?.kind === "garbage") return new Response("<html>oops</html>", { status: 201 });

    if (req.headers.get("authorization") !== `Bearer ${this.apiKey}`) {
      return error(401, "unauthorized", "Invalid API key.");
    }
    if (req.method === "POST" && url.pathname === "/v1/messages") return this.send(body);
    if (req.method === "GET" && url.pathname === "/v1/messages") return this.list(url.searchParams);
    if (req.method === "GET" && url.pathname === "/v1/templates/approved") {
      return Response.json({
        data: this.templates.filter((t) => t.status === "approved"),
        next_cursor: null,
      });
    }
    if (req.method === "GET" && url.pathname === "/v1/organizations/current") {
      return Response.json({
        id: this.organizationId,
        name: "Fake organization",
        slug: "fake-org",
        role: this.apiKeyRole,
        created_at: "2026-01-01T00:00:00.000Z",
      });
    }
    const hookPath = /^\/v1\/webhooks(?:\/([^/]+))?(\/deliveries|\/events)?$/.exec(url.pathname);
    if (hookPath) {
      if (this.apiKeyRole === "member") return error(403, "forbidden", "This route needs the admin role.");
      const [, id, sub] = hookPath;
      const deliveries = sub === "/deliveries";
      if (req.method === "GET" && id !== undefined && sub === "/events") return this.events(id, url.searchParams);
      if (req.method === "POST" && id === undefined) return this.createWebhook(body);
      if (req.method === "GET" && id !== undefined && sub === undefined) {
        const hook = this.webhooks.get(id);
        if (!hook) return error(404, "not_found", "No webhook with this id.");
        const { secret: _secret, ...rest } = hook;
        return Response.json(rest);
      }
      if (req.method === "DELETE" && id !== undefined && sub === undefined) {
        return this.webhooks.delete(id) ? new Response(null, { status: 204 }) : error(404, "not_found", "No webhook with this id.");
      }
      if (req.method === "GET" && id !== undefined && deliveries) {
        if (!this.webhooks.has(id)) return error(404, "not_found", "No webhook with this id.");
        const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : 50;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) return error(400, "validation_failed", "Bad limit.");
        const data = this.deliveries
          .filter((d) => d.webhook_id === id)
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || (a.id < b.id ? 1 : -1))
          .slice(0, limit);
        return Response.json({ data, next_cursor: null });
      }
    }
    return error(404, "not_found", "No route.");
  }

  /** Adds one attempt to a webhook's delivery history, newest last (the list sorts newest first). */
  recordDelivery(webhookId: string, fields: Partial<FakeUatisDelivery> = {}): FakeUatisDelivery {
    const delivery: FakeUatisDelivery = {
      id: randomUUID(),
      webhook_id: webhookId,
      event_type: "message.created",
      resource_type: "message",
      resource_id: randomUUID(),
      status: "delivered",
      attempt_no: 1,
      http_status: 200,
      duration_ms: 42,
      created_at: this.stamp(),
      delivered_at: null,
      ...fields,
    };
    this.deliveries.push(delivery);
    return delivery;
  }

  private createWebhook(raw: unknown): Response {
    if (typeof raw !== "object" || raw === null) return error(400, "validation_failed", "Body must be JSON.");
    const b = raw as { url?: unknown; events?: unknown; description?: unknown; mode?: unknown };
    const mode = b.mode === undefined ? "push" : b.mode;
    if (mode !== "push" && mode !== "pull") return error(422, "validation_failed", "mode must be push or pull.");
    if (mode === "pull" && b.url !== undefined && b.url !== null) {
      return error(422, "validation_failed", "A pull webhook takes no url.");
    }
    if (mode === "push") {
      if (typeof b.url !== "string") return error(422, "validation_failed", "url is required.");
      let target: URL;
      try {
        target = new URL(b.url);
      } catch {
        return error(422, "validation_failed", "Must be an absolute http or https URL.");
      }
      // backend-uatis `checkWebhookTarget`: scheme, credentials, default port, literal private address.
      const host = target.hostname.replace(/^\[|\]$/g, "");
      const literal = /^[\d.]+$/.test(host) || host.includes(":");
      if (
        (target.protocol !== "https:" && target.protocol !== "http:") ||
        target.username !== "" ||
        target.port !== "" ||
        (literal ? isBlockedAddress(host) : isBlockedHostname(host))
      ) {
        return error(422, "validation_failed", "Must not be a private, loopback, or link-local address.");
      }
    }
    const allowed = ["message.created", "message.updated", "conversation.updated"];
    if (!Array.isArray(b.events) || b.events.length === 0 || !b.events.every((e) => allowed.includes(String(e)))) {
      return error(422, "validation_failed", "Unknown event.");
    }
    const now = this.stamp();
    const hook: FakeUatisWebhook = {
      id: randomUUID(),
      mode,
      url: mode === "push" ? String(b.url) : null,
      description: typeof b.description === "string" ? b.description : null,
      events: b.events.map(String),
      status: "active",
      secret: mode === "push" ? randomBytes(32).toString("base64url") : null,
      created_at: now,
      updated_at: now,
    };
    this.webhooks.set(hook.id, hook);
    const { secret, ...rest } = hook;
    return Response.json(secret === null ? rest : hook, { status: 201 });
  }

  private events(webhookId: string, params: URLSearchParams): Response {
    if (!this.feedSupported) return error(404, "not_found", "No route.");
    if (!this.webhooks.has(webhookId)) return error(404, "not_found", "No webhook with this id.");
    const limit = params.has("limit") ? Number(params.get("limit")) : 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return error(400, "validation_failed", "Bad limit.");
    let after: { t: string; id: string } | null = null;
    const raw = params.get("after");
    if (raw !== null) {
      try {
        after = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { t: string; id: string };
        if (typeof after.t !== "string" || typeof after.id !== "string") throw new Error("bad");
      } catch {
        return Response.json(
          { error: { code: "validation_failed", message: "Invalid cursor.", details: [{ path: "after", code: "invalid", message: "Not a cursor this API issued." }] } },
          { status: 400 },
        );
      }
    }
    const key = (t: string, id: string) => `${t}|${id}`;
    const rest = this.feed
      .filter((f) => f.webhookId === webhookId)
      .filter((f) => after === null || key(f.createdAt, f.deliveryId) > key(after.t, after.id));
    const page = rest.slice(0, limit);
    const data = page.map((f) => ({ cursor: f.cursor, ...(JSON.parse(f.body) as Record<string, unknown>) }));
    // backend-uatis: the last event's cursor, or the `after` that was sent when nothing is new.
    return Response.json({ data, next_cursor: page.at(-1)?.cursor ?? raw });
  }

  private send(raw: unknown): Response {
    if (typeof raw !== "object" || raw === null) return error(400, "validation_failed", "Body must be JSON.");
    const b = raw as { to?: unknown; from_address?: unknown; text?: { body?: unknown }; template?: { name?: unknown } };
    if (typeof b.to !== "string" || !/^\+?[1-9]\d{7,14}$/.test(b.to)) {
      return error(422, "validation_failed", "Must be E.164.");
    }
    const parts = [b.text, b.template].filter((p) => p !== undefined);
    if (parts.length !== 1) return error(422, "validation_failed", "Send exactly one of text, media, or template.");
    if (!this.lineConnected) return error(422, "whatsapp_disconnected", "This WhatsApp line is disconnected.");
    if (b.text !== undefined && this.enforceWindow) {
      const cutoff = Date.now() - 24 * 3600_000;
      const inbound = this.rows.some(
        (r) => r.direction === "in" && r.contact_address === b.to && Date.parse(r.created_at) > cutoff,
      );
      if (!inbound) return error(422, "outside_service_window", "The 24-hour customer service window is closed.");
    }
    const content =
      b.text !== undefined
        ? { version: "1", type: "text", kind: "text", text: String(b.text.body ?? "") }
        : { version: "1", type: "data", kind: "template", data: { name: b.template?.name } };
    const row: FakeUatisRow = {
      id: randomUUID(),
      conversation_id: this.conversationFor(b.to),
      direction: "out",
      content,
      status: { state: "pending", errors: [] },
      external_id: null,
      contact_address: b.to,
      created_at: this.stamp(),
    };
    this.rows.push(row);
    this.emit("message.created", row);
    return Response.json(
      {
        id: row.id,
        conversation_id: row.conversation_id,
        direction: "out",
        status: { state: "pending" },
        created_at: row.created_at,
      },
      { status: 201 },
    );
  }

  private list(params: URLSearchParams): Response {
    const limit = params.has("limit") ? Number(params.get("limit")) : 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return error(400, "validation_failed", "Bad limit.");
    const direction = params.get("direction");
    if (direction !== null && direction !== "in" && direction !== "out") {
      return error(400, "validation_failed", "Bad direction.");
    }
    const from = params.get("from");
    const fromMs = from === null ? Number.NEGATIVE_INFINITY : Date.parse(from);
    if (Number.isNaN(fromMs)) return error(400, "validation_failed", "Bad from.");

    let after: { t: string; id: string } | null = null;
    const cursor = params.get("cursor");
    if (cursor !== null) {
      try {
        const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { t: string; id: string };
        after = { t: parsed.t, id: parsed.id };
      } catch {
        return error(400, "validation_failed", "The cursor is not one this API issued.");
      }
    }

    const keyDesc = (a: FakeUatisRow, b: FakeUatisRow) =>
      Date.parse(b.created_at) - Date.parse(a.created_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
    const isAfter = (r: FakeUatisRow) => {
      if (!after) return true;
      const d = Date.parse(r.created_at) - Date.parse(after.t);
      return d < 0 || (d === 0 && r.id < after.id);
    };
    const matching = this.rows
      .filter((r) => (direction === null ? true : r.direction === direction))
      .filter((r) => Date.parse(r.created_at) >= fromMs)
      .sort(keyDesc)
      .filter(isAfter);
    const page = matching.slice(0, limit);
    const last = page.at(-1);
    const next =
      matching.length > page.length && last
        ? Buffer.from(JSON.stringify({ v: 1, t: last.created_at, id: last.id })).toString("base64url")
        : null;
    return Response.json({ data: page, next_cursor: next });
  }
}

function error(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}
