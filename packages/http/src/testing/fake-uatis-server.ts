// A local stand-in for backend-uatis (tests and the gated UATIS_E2E suite's dry run).
// It mimics the routes UatisGateway calls, with the shapes backend-uatis really
// returns (backend-uatis packages/http/src/routes/read.ts, templates.ts,
// services/send.ts, services/mappers.ts):
//
//   POST /v1/messages              201 { id, conversation_id, direction: "out", status: { state: "pending" }, created_at }
//   GET  /v1/messages              200 { data: Message[], next_cursor } newest first, keyset cursor
//   GET  /v1/templates/approved    200 { data: Template[], next_cursor: null }
//
// Stored text content is `{ version: "1", type: "text", kind: "text", text: "<string>" }`.
// Errors use the backend-uatis envelope `{ error: { code, message } }`.

import { randomUUID } from "node:crypto";

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
    return row;
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
    const text = req.method === "POST" ? await req.text() : "";
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
    return error(404, "not_found", "No route.");
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
