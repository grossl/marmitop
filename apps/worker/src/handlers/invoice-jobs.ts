// mt_invoice_jobs: issue, poll, and cancel through web-nf (ADR-003, ADR-016;
// FR-124, FR-125, FR-127, FR-130, FR-136, FR-137; 08.fiscal-mapping.md sections 6 and 8).
//
// Every web-nf call here is safe to retry: POSTs carry an Idempotency-Key bound to the
// exact body, and the body of an issue is the frozen `order_invoices.request_payload`.
// So transport errors (timeout, 5xx, connection, 429) retry on the framework schedule
// (classifyUpstreamFailure), and only a refusal stops the job.
//
//   issue  ─ skip (gone, not queued, already sent) ───────────────▶ ok
//          ─ invalid frozen payload ──────────────────────────────▶ failed invalid_payload (no call)
//          ─ not configured ──────────────────────────────────────▶ failed fiscal_not_configured
//          ─ POST /v1/invoices ─ 202 ─▶ external_id + status, poll in 30 s
//                              ─ transient ─▶ retry (same key, same body)
//                              ─ 4xx ─▶ failed <code> with the 08 text
//   poll   ─ GET /v1/invoices/{id} ─▶ applyInvoiceUpdate; non-final ─▶ next poll with backoff
//   cancel ─ POST /v1/invoices/{id}/events cancelamento ─▶ poll in 30 s; 4xx frees the request

import {
  AMBIGUOUS_ERROR_CODE,
  classifyUpstreamFailure,
  GatewayError,
  type InvoiceGateway,
  type InvoiceRequestBody,
  type InvoiceView,
  mapValidationDetail,
  mapWebNfError,
} from "@mt/core";
import { QUEUES } from "@mt/db";
import type { GatewayConnection } from "@mt/http";
import { type InvoiceJob, invoiceJobSchema } from "@mt/schemas";

import type { JobHandler, JobOutcome } from "../framework/types";

export type IssueLoad =
  | { readonly kind: "ready"; readonly payload: InvoiceRequestBody; readonly connection: GatewayConnection }
  | { readonly kind: "skip" }
  | { readonly kind: "invalid"; readonly reason: string }
  | { readonly kind: "not_configured" };

export type PollLoad =
  | { readonly kind: "ready"; readonly externalId: string; readonly connection: GatewayConnection }
  | { readonly kind: "skip" }
  | { readonly kind: "not_configured" };

export type CancelLoad =
  | {
      readonly kind: "ready";
      readonly externalId: string;
      readonly justificativa: string;
      /** One key per cancel request: retries of the same request reuse it (08 section 6.2). */
      readonly idempotencyKey: string;
      readonly connection: GatewayConnection;
    }
  | { readonly kind: "skip" }
  | { readonly kind: "not_configured" };

export interface InvoiceJobStore {
  loadIssue(restaurantId: string, orderInvoiceId: string): Promise<IssueLoad>;
  /** Stores `external_id` and the status, and queues a poll in `pollDelaySeconds`, in one transaction. */
  markSubmitted(
    restaurantId: string,
    orderInvoiceId: string,
    externalId: string,
    status: string,
    pollDelaySeconds: number,
  ): Promise<void>;
  /** Moves a non-final row to `failed` with the code and the pt-BR text. */
  markFailed(restaurantId: string, orderInvoiceId: string, errorCode: string, errorMessage: string): Promise<void>;
  markIntegrationError(restaurantId: string, message: string): Promise<void>;
  loadPoll(restaurantId: string, orderInvoiceId: string): Promise<PollLoad>;
  /** `applyInvoiceUpdate` with the remote view. Returns the row's status after it. */
  applyRemote(restaurantId: string, orderInvoiceId: string, view: InvoiceView): Promise<{ status: string | null }>;
  schedulePoll(restaurantId: string, orderInvoiceId: string, delaySeconds: number, round: number): Promise<void>;
  loadCancel(restaurantId: string, orderInvoiceId: string): Promise<CancelLoad>;
  /** Records why the cancel did not go through and clears the request, so the admin can retry. */
  markCancelFailed(
    restaurantId: string,
    orderInvoiceId: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<void>;
}

export interface InvoiceHandlerDeps {
  readonly store: InvoiceJobStore;
  readonly gatewayFor: (conn: GatewayConnection) => InvoiceGateway;
}

const NOT_CONFIGURED = "Configure a integração fiscal em Configurações.";
const NO_ANSWER = "O serviço fiscal não respondeu.";
const INVALID_PAYLOAD = "Os dados guardados da nota estão incompletos. Emita novamente.";
const FIRST_POLL_SECONDS = 30;
const MAX_POLL_SECONDS = 600;
/** After this many self-scheduled polls the chain stops; the `mt_invoice_poll` cron still covers the row. */
export const MAX_POLL_ROUNDS = 40;
const NON_FINAL = new Set(["queued", "received", "processing"]);

/** 30 s, 60 s, 120 s, ... capped at 10 minutes (FR-127). */
export function pollDelaySeconds(round: number): number {
  return Math.min(MAX_POLL_SECONDS, FIRST_POLL_SECONDS * 2 ** Math.min(round, 10));
}

function itemNames(payload: InvoiceRequestBody): string[] {
  const itens = payload.kind === "nfce" ? payload.nfce.itens : payload.nfe.itens;
  return itens.map((i) => i.descricao);
}

/** The pt-BR text for a web-nf refusal (08 sections 8.1 and 8.2). */
export function refusalText(error: GatewayError, payload?: InvoiceRequestBody): string {
  const f = error.failure;
  const status = f.kind === "http" ? f.status : 0;
  const code = f.kind === "http" ? f.code : undefined;
  const base = mapWebNfError(status, code).message;
  if (code === "validation_failed" && payload && error.details && error.details.length > 0) {
    const names = itemNames(payload);
    const lines = [...new Set(error.details.map((d) => mapValidationDetail(d.path, names)))];
    return `${base} ${lines.join(" ")}`.slice(0, 500);
  }
  return base;
}

type Classified =
  | { readonly kind: "retry"; readonly outcome: JobOutcome }
  | {
      readonly kind: "refused";
      readonly errorCode: string;
      readonly httpStatus?: number;
      readonly error: GatewayError;
    };

function classify(error: unknown): Classified {
  if (!(error instanceof GatewayError)) throw error;
  const httpStatus = error.failure.kind === "http" ? error.failure.status : undefined;
  const c = classifyUpstreamFailure(error.failure);
  if (c.failure === "transient") {
    return {
      kind: "retry",
      outcome: {
        kind: "retry",
        errorCode: c.errorCode,
        ...(httpStatus !== undefined ? { httpStatus } : {}),
        ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
      },
    };
  }
  return { kind: "refused", errorCode: c.errorCode, error, ...(httpStatus !== undefined ? { httpStatus } : {}) };
}

const fail = (errorCode: string, httpStatus?: number): JobOutcome => ({
  kind: "fail",
  errorCode,
  ...(httpStatus !== undefined ? { httpStatus } : {}),
});

function base(op: InvoiceJob["op"]) {
  return {
    name: `invoice.${op}`,
    queue: QUEUES.invoiceJobs,
    op,
    schema: invoiceJobSchema,
    subjectType: "order_invoice" as const,
    subjectId: (job: InvoiceJob) => job.orderInvoiceId,
  };
}

export function createInvoiceIssueHandler(deps: InvoiceHandlerDeps): JobHandler<InvoiceJob> {
  const { store } = deps;
  return {
    ...base("issue"),
    async run({ payload: job }) {
      const load = await store.loadIssue(job.restaurantId, job.orderInvoiceId);
      if (load.kind === "skip") return { kind: "ok" };
      if (load.kind === "not_configured") {
        await store.markFailed(job.restaurantId, job.orderInvoiceId, "fiscal_not_configured", NOT_CONFIGURED);
        return fail("fiscal_not_configured");
      }
      if (load.kind === "invalid") {
        await store.markFailed(job.restaurantId, job.orderInvoiceId, "invalid_payload", INVALID_PAYLOAD);
        return fail("invalid_payload");
      }
      try {
        const result = await deps.gatewayFor(load.connection).createInvoice(load.payload, job.orderInvoiceId);
        await store.markSubmitted(job.restaurantId, job.orderInvoiceId, result.id, result.status, FIRST_POLL_SECONDS);
        return { kind: "ok" };
      } catch (error) {
        const c = classify(error);
        if (c.kind === "retry") return c.outcome;
        const message = refusalText(c.error, load.payload);
        await store.markFailed(job.restaurantId, job.orderInvoiceId, c.errorCode, message);
        if (c.httpStatus === 401) await store.markIntegrationError(job.restaurantId, message);
        return fail(c.errorCode, c.httpStatus);
      }
    },
    // Transport failures only reach here. The request may have reached web-nf, so the row is
    // `ambiguous`: "Emitir novamente" resends this row with the same key and body (08 section 6).
    async onExhausted({ payload: job }) {
      await store.markFailed(job.restaurantId, job.orderInvoiceId, AMBIGUOUS_ERROR_CODE, NO_ANSWER);
    },
  };
}

export function createInvoicePollHandler(deps: InvoiceHandlerDeps): JobHandler<InvoiceJob> {
  const { store } = deps;
  return {
    ...base("poll"),
    async run({ payload: job }) {
      const load = await store.loadPoll(job.restaurantId, job.orderInvoiceId);
      if (load.kind === "skip") return { kind: "ok" };
      if (load.kind === "not_configured") return fail("fiscal_not_configured");
      let view: InvoiceView;
      try {
        view = await deps.gatewayFor(load.connection).getInvoice(load.externalId);
      } catch (error) {
        const c = classify(error);
        if (c.kind === "retry") return c.outcome;
        const message = refusalText(c.error);
        if (c.httpStatus === 404) await store.markFailed(job.restaurantId, job.orderInvoiceId, c.errorCode, message);
        if (c.httpStatus === 401) await store.markIntegrationError(job.restaurantId, message);
        return fail(c.errorCode, c.httpStatus);
      }
      const after = await store.applyRemote(job.restaurantId, job.orderInvoiceId, view);
      const round = job.pollRound ?? 0;
      if (after.status !== null && NON_FINAL.has(after.status) && round < MAX_POLL_ROUNDS) {
        await store.schedulePoll(job.restaurantId, job.orderInvoiceId, pollDelaySeconds(round), round + 1);
      }
      return { kind: "ok" };
    },
    // Nothing to mark: the row keeps its state and the cron polls it again.
  };
}

export function createInvoiceCancelHandler(deps: InvoiceHandlerDeps): JobHandler<InvoiceJob> {
  const { store } = deps;
  return {
    ...base("cancel"),
    async run({ payload: job }) {
      const load = await store.loadCancel(job.restaurantId, job.orderInvoiceId);
      if (load.kind === "skip") return { kind: "ok" };
      if (load.kind === "not_configured") {
        await store.markCancelFailed(job.restaurantId, job.orderInvoiceId, "fiscal_not_configured", NOT_CONFIGURED);
        return fail("fiscal_not_configured");
      }
      try {
        await deps.gatewayFor(load.connection).cancelInvoice(load.externalId, load.justificativa, load.idempotencyKey);
        await store.schedulePoll(job.restaurantId, job.orderInvoiceId, FIRST_POLL_SECONDS, 0);
        return { kind: "ok" };
      } catch (error) {
        const c = classify(error);
        if (c.kind === "retry") return c.outcome;
        const message = refusalText(c.error);
        await store.markCancelFailed(job.restaurantId, job.orderInvoiceId, c.errorCode, message);
        if (c.httpStatus === 401) await store.markIntegrationError(job.restaurantId, message);
        return fail(c.errorCode, c.httpStatus);
      }
    },
    async onExhausted({ payload: job }, last) {
      await store.markCancelFailed(job.restaurantId, job.orderInvoiceId, last.errorCode, NO_ANSWER);
    },
  };
}
