// A local stand-in for the web-nf generation API (tests and the gated NF_E2E dry run).
// It mimics the routes WebNfGateway calls, with the shapes web-nf really returns
// (web-nf apps/generation-api/src/app.ts, packages/http/src/services/get-invoice.ts,
// create-invoice.ts, create-event.ts, idempotency.ts):
//
//   POST /v1/invoices                202 { id, status: "queued", kind }  (Idempotency-Replayed: true on a replay)
//   GET  /v1/invoices/{id}           200 InvoiceResponse; a non-uuid or unknown id is 404 not_found
//   POST /v1/invoices/{id}/events    202 { id, status: "queued" }; 409 conflict unless authorized
//
// Idempotency: the key binds to the SHA-256 of the raw body. The same key and body replays
// the stored response; another body is 409 idempotency_conflict. Errors use the envelope
// `{ error: { code, message, details? } }`.

import { createHash, randomUUID } from "node:crypto";

export interface FakeWebNfInvoice {
  id: string;
  kind: string;
  status: string;
  reference: string | null;
  numero: number | null;
  serie: number | string | null;
  chave_acesso: string | null;
  error: { code: string; message: string } | null;
  files: { xml?: string; protocolo_xml?: string; pdf?: string };
  events: { id: string; invoice_id: string; type: string; status: string; error: unknown; created_at: string }[];
  created_at: string;
  authorized_at: string | null;
  cancelled_at: string | null;
  body: unknown;
}

export interface FakeWebNfRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | null;
  readonly idempotencyKey: string | null;
  readonly rawBody: string;
  readonly body: unknown;
}

export type FakeWebNfScript =
  | {
      readonly kind: "status";
      readonly status: number;
      readonly code?: string;
      readonly details?: readonly { path: string; code: string; message: string }[];
      readonly retryAfter?: string;
    }
  | { readonly kind: "delay"; readonly ms: number }
  | { readonly kind: "garbage" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function error(status: number, code: string, message: string, details?: unknown): Response {
  return Response.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

export class FakeWebNfServer {
  readonly apiKey: string;
  readonly requests: FakeWebNfRequest[] = [];
  readonly invoices = new Map<string, FakeWebNfInvoice>();
  private readonly keys = new Map<string, { hash: string; status: number; body: unknown }>();
  private readonly scripts: { match: string; script: FakeWebNfScript }[] = [];
  private server: ReturnType<typeof Bun.serve> | null = null;
  private numero = 0;

  constructor(options: { apiKey?: string } = {}) {
    this.apiKey = options.apiKey ?? "nfk_test_fake";
  }

  start(): this {
    this.server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => this.handle(req) });
    return this;
  }

  get baseUrl(): string {
    if (!this.server) throw new Error("FakeWebNfServer is not started");
    return `http://127.0.0.1:${this.server.port}`;
  }

  async stop(): Promise<void> {
    this.server?.stop(true);
    this.server = null;
  }

  /** Script the next request whose `METHOD /path` starts with `match`. */
  scriptNext(match: string, script: FakeWebNfScript): this {
    this.scripts.push({ match, script });
    return this;
  }

  /** SEFAZ authorized the invoice: number, key, and signed file URLs appear. */
  authorize(id: string, at = new Date()): FakeWebNfInvoice {
    const inv = this.must(id);
    this.numero += 1;
    inv.status = "authorized";
    inv.numero = this.numero;
    inv.serie = 1;
    inv.chave_acesso = `4226100123456700018965001${String(this.numero).padStart(9, "0")}1000000001`.slice(0, 44);
    inv.authorized_at = at.toISOString();
    inv.files = {
      xml: `${this.baseUrl}/files/${id}.xml?token=signed`,
      protocolo_xml: `${this.baseUrl}/files/${id}-prot.xml?token=signed`,
      pdf: `${this.baseUrl}/files/${id}.pdf?token=signed`,
    };
    return inv;
  }

  /** SEFAZ refused the invoice with a government code. */
  reject(id: string, code: string, message: string): FakeWebNfInvoice {
    const inv = this.must(id);
    inv.status = "rejected";
    inv.error = { code, message };
    return inv;
  }

  /** The queued cancel event settles: authorized cancels the invoice, rejected leaves it authorized. */
  settleCancel(id: string, outcome: "authorized" | "rejected"): FakeWebNfInvoice {
    const inv = this.must(id);
    const ev = [...inv.events].reverse().find((e) => e.type === "cancelamento");
    if (!ev) throw new Error(`FakeWebNfServer: no cancel event on ${id}`);
    ev.status = outcome;
    if (outcome === "authorized") {
      inv.status = "cancelled";
      inv.cancelled_at = new Date().toISOString();
    } else {
      ev.error = { code: "501", message: "Rejeição: Prazo de cancelamento superior ao previsto na Legislação" };
    }
    return inv;
  }

  private must(id: string): FakeWebNfInvoice {
    const inv = this.invoices.get(id);
    if (!inv) throw new Error(`FakeWebNfServer: no invoice ${id}`);
    return inv;
  }

  private takeScript(method: string, path: string): FakeWebNfScript | undefined {
    const key = `${method} ${path}`;
    const i = this.scripts.findIndex((s) => key.startsWith(s.match));
    if (i < 0) return undefined;
    const [entry] = this.scripts.splice(i, 1);
    return entry?.script;
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const rawBody = req.method === "POST" ? await req.text() : "";
    let body: unknown = null;
    try {
      body = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      body = undefined;
    }
    const idempotencyKey = req.headers.get("idempotency-key");
    this.requests.push({
      method: req.method,
      path: url.pathname,
      authorization: req.headers.get("authorization"),
      idempotencyKey,
      rawBody,
      body,
    });

    const script = this.takeScript(req.method, url.pathname);
    if (script?.kind === "delay") await Bun.sleep(script.ms);
    if (script?.kind === "status") {
      return Response.json(
        {
          error: {
            code: script.code ?? "internal_error",
            message: "scripted",
            ...(script.details ? { details: script.details } : {}),
          },
        },
        { status: script.status, headers: script.retryAfter ? { "retry-after": script.retryAfter } : {} },
      );
    }
    if (script?.kind === "garbage") return new Response("<html>oops</html>", { status: 202 });

    if (url.pathname === "/v1/health") return Response.json({ status: "ok" });
    if (req.headers.get("authorization") !== `Bearer ${this.apiKey}`) {
      return error(401, "unauthorized", "Authentication required.");
    }

    if (req.method === "POST" && url.pathname === "/v1/invoices") {
      return this.idempotent(idempotencyKey, rawBody, () => this.create(body));
    }
    const m = /^\/v1\/invoices\/([^/]+)(\/events)?$/.exec(url.pathname);
    if (m) {
      const id = decodeURIComponent(m[1] as string);
      const inv = UUID.test(id) ? this.invoices.get(id) : undefined;
      if (!inv) return error(404, "not_found", "The resource was not found.");
      if (req.method === "GET" && !m[2]) return Response.json(this.view(inv));
      if (req.method === "POST" && m[2]) return this.idempotent(idempotencyKey, rawBody, () => this.event(inv, body));
    }
    return error(404, "not_found", "Route not found.");
  }

  private idempotent(key: string | null, rawBody: string, run: () => { status: number; body: unknown }): Response {
    if (key === null) {
      const r = run();
      return Response.json(r.body, { status: r.status });
    }
    const hash = createHash("sha256").update(rawBody).digest("hex");
    const stored = this.keys.get(key);
    if (stored) {
      if (stored.hash !== hash) {
        return error(409, "idempotency_conflict", "This Idempotency-Key was used with a different request body.");
      }
      return Response.json(stored.body, { status: stored.status, headers: { "idempotency-replayed": "true" } });
    }
    const r = run();
    if (r.status < 500) this.keys.set(key, { hash, status: r.status, body: r.body });
    return Response.json(r.body, { status: r.status });
  }

  private create(body: unknown): { status: number; body: unknown } {
    if (typeof body !== "object" || body === null) {
      return { status: 422, body: { error: { code: "validation_failed", message: "The request body is invalid." } } };
    }
    const b = body as { kind?: unknown; reference?: unknown };
    if (b.kind !== "nfce" && b.kind !== "nfe") {
      return {
        status: 422,
        body: {
          error: {
            code: "validation_failed",
            message: "The request body is invalid.",
            details: [{ path: "kind", code: "invalid_enum_value", message: "Invalid kind." }],
          },
        },
      };
    }
    const id = randomUUID();
    this.invoices.set(id, {
      id,
      kind: b.kind,
      status: "queued",
      reference: typeof b.reference === "string" ? b.reference : null,
      numero: null,
      serie: null,
      chave_acesso: null,
      error: null,
      files: {},
      events: [],
      created_at: new Date().toISOString(),
      authorized_at: null,
      cancelled_at: null,
      body,
    });
    return { status: 202, body: { id, status: "queued", kind: b.kind } };
  }

  private event(inv: FakeWebNfInvoice, body: unknown): { status: number; body: unknown } {
    const b = (body ?? {}) as { type?: unknown; justificativa?: unknown };
    if (b.type !== "cancelamento" || typeof b.justificativa !== "string" || b.justificativa.length < 15) {
      return { status: 422, body: { error: { code: "validation_failed", message: "The request body is invalid." } } };
    }
    if (inv.status !== "authorized") {
      return {
        status: 409,
        body: { error: { code: "conflict", message: "Only an authorized invoice accepts events." } },
      };
    }
    const id = randomUUID();
    inv.events.push({
      id,
      invoice_id: inv.id,
      type: "cancelamento",
      status: "queued",
      error: null,
      created_at: new Date().toISOString(),
    });
    return { status: 202, body: { id, status: "queued" } };
  }

  private view(inv: FakeWebNfInvoice) {
    return {
      id: inv.id,
      kind: inv.kind,
      status: inv.status,
      reference: inv.reference,
      numero: inv.numero,
      serie: inv.serie,
      chave_acesso: inv.chave_acesso,
      nfse_numero: null,
      codigo_verificacao: null,
      qr_code: null,
      url_chave: null,
      protocolo: inv.status === "authorized" ? "342260000000001" : null,
      error: inv.error,
      valor_total: null,
      files: inv.files,
      events: inv.events.map((e) => ({ ...e, justificativa: null, correcao: null, protocolo: null })),
      created_at: inv.created_at,
      authorized_at: inv.authorized_at,
      cancelled_at: inv.cancelled_at,
    };
  }
}
