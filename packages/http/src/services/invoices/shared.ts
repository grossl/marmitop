// Shared pieces of the invoice services, the worker stores, and the web-nf webhook
// (08.fiscal-mapping.md section 6, ADR-003, ADR-016; FR-120..FR-139).
//
// `applyInvoiceUpdate` is the one write path for what web-nf reports: the poll job, the
// webhook, `refreshInvoice`, and `getInvoiceFiles` all go through it, so the status rule
// (core `decideInvoiceUpdate`, FR-136) holds on every path.

import {
  decideInvoiceUpdate,
  describeSefazRejection,
  type IncomingInvoiceState,
  type InvoiceEventState,
  type InvoiceKind,
  type InvoicePatch,
  type InvoiceStatusValue,
  invoiceErrorText,
  latestCancelOutcome,
} from "@mt/core";
import { QUEUES, sendJob, type Tx } from "@mt/db";
import type { InvoiceJob } from "@mt/schemas";

import type { ServiceDeps } from "../../deps";
import { openSecret } from "../admin/internal";
import { recordUsage } from "../billing/usage";
import { emitEvent } from "../webhooks/emit";
import { systemCtx } from "../whatsapp/connection";

/** One `order_invoices` row as the dashboard sees it. Never carries XML or PDF URLs. */
export interface OrderInvoiceView {
  readonly id: string;
  readonly orderId: string;
  readonly kind: InvoiceKind;
  readonly status: InvoiceStatusValue;
  readonly numero: number | null;
  readonly serie: number | null;
  readonly chaveAcesso: string | null;
  readonly errorCode: string | null;
  /** The pt-BR hint (08 section 8, FR-131). The raw text stays in the database. */
  readonly errorText: string | null;
  readonly cancelRequestedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InvoiceRow {
  readonly id: string;
  readonly order_id: string;
  readonly kind: InvoiceKind;
  readonly status: InvoiceStatusValue;
  readonly external_id: string | null;
  readonly numero: number | null;
  readonly serie: number | null;
  readonly chave_acesso: string | null;
  readonly error_code: string | null;
  readonly error_message: string | null;
  readonly request_payload: unknown;
  readonly cancel_requested_at: Date | null;
  readonly cancel_reason: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export const INVOICE_COLUMNS = `
  id, order_id, kind, status, external_id, numero, serie, chave_acesso, error_code, error_message,
  request_payload, cancel_requested_at, cancel_reason, created_at, updated_at
`;

/** Statuses that hold the order's one live invoice (05 partial unique index). */
export const LIVE_INVOICE_STATUSES: readonly InvoiceStatusValue[] = ["queued", "received", "processing", "authorized"];

export function toInvoiceView(r: InvoiceRow): OrderInvoiceView {
  return {
    id: r.id,
    orderId: r.order_id,
    kind: r.kind,
    status: r.status,
    numero: r.numero,
    serie: r.serie,
    chaveAcesso: r.chave_acesso,
    errorCode: r.error_code,
    errorText: invoiceErrorText({ status: r.status, errorCode: r.error_code, errorMessage: r.error_message }),
    cancelRequestedAt: r.cancel_requested_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function loadInvoiceRow(
  tx: Tx,
  restaurantId: string,
  orderInvoiceId: string,
  lock = false,
): Promise<InvoiceRow | undefined> {
  const rows = await tx.unsafe<InvoiceRow[]>(
    `select ${INVOICE_COLUMNS} from public.order_invoices where restaurant_id = $1 and id = $2${lock ? " for update" : ""}`,
    [restaurantId, orderInvoiceId],
  );
  return rows[0];
}

export async function listOrderInvoices(tx: Tx, restaurantId: string, orderId: string): Promise<OrderInvoiceView[]> {
  const rows = await tx.unsafe<InvoiceRow[]>(
    `select ${INVOICE_COLUMNS} from public.order_invoices
     where restaurant_id = $1 and order_id = $2 order by created_at desc, id`,
    [restaurantId, orderId],
  );
  return rows.map(toInvoiceView);
}

// ---------------------------------------------------------------------------
// The web-nf connection (ADR-012: secrets unsealed into local values only)
// ---------------------------------------------------------------------------

export interface FiscalConnection {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly status: "disconnected" | "connected" | "error";
}

/** Null when the restaurant has no fiscal integration row. */
export async function loadFiscalConnection(
  tx: Tx,
  deps: ServiceDeps,
  restaurantId: string,
): Promise<FiscalConnection | null> {
  const [row] = await tx<{ base_url: string; api_key_secret_id: string; status: FiscalConnection["status"] }[]>`
    select base_url, api_key_secret_id, status from public.integrations_fiscal where restaurant_id = ${restaurantId}
  `;
  if (row === undefined) return null;
  const apiKey = await openSecret(tx, deps, systemCtx(restaurantId), row.api_key_secret_id, "webnf_api_key");
  return { baseUrl: row.base_url, apiKey, status: row.status };
}

/**
 * The web-nf webhook signing secret, or null when there is no fiscal row or the admin
 * disconnected it (FR-126, same rule as backend-uatis FR-118).
 */
export async function loadFiscalWebhookSecret(tx: Tx, deps: ServiceDeps, restaurantId: string): Promise<string | null> {
  const [row] = await tx<{ webhook_secret_id: string; status: FiscalConnection["status"] }[]>`
    select webhook_secret_id, status from public.integrations_fiscal where restaurant_id = ${restaurantId}
  `;
  if (row === undefined || row.status === "disconnected") return null;
  return openSecret(tx, deps, systemCtx(restaurantId), row.webhook_secret_id, "webnf_webhook_secret");
}

/** 08 section 8.1: a refused API key marks the integration `error`. */
export async function markFiscalIntegrationError(tx: Tx, restaurantId: string, message: string): Promise<void> {
  await tx`
    update public.integrations_fiscal set status = 'error', last_error = ${message.slice(0, 200)}
    where restaurant_id = ${restaurantId} and status <> 'disconnected'
  `;
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export async function enqueueInvoiceJob(
  tx: Tx,
  restaurantId: string,
  orderInvoiceId: string,
  op: InvoiceJob["op"],
  delaySeconds = 0,
  pollRound?: number,
): Promise<void> {
  const job: InvoiceJob = {
    v: 1,
    restaurantId,
    orderInvoiceId,
    op,
    ...(pollRound !== undefined ? { pollRound } : {}),
  };
  await sendJob(tx, QUEUES.invoiceJobs, job, delaySeconds);
}

// ---------------------------------------------------------------------------
// Updates from web-nf (FR-127, FR-136)
// ---------------------------------------------------------------------------

export interface IncomingWithEvents extends IncomingInvoiceState {
  readonly events?: readonly InvoiceEventState[];
}

export interface ApplyInvoiceResult {
  /** False when the row was already in this state (FR-136) or does not exist. */
  readonly changed: boolean;
  readonly found: boolean;
  readonly from: InvoiceStatusValue | null;
  readonly status: InvoiceStatusValue | null;
}

const COLUMN: Readonly<Record<keyof InvoicePatch, string>> = {
  status: "status",
  numero: "numero",
  serie: "serie",
  chaveAcesso: "chave_acesso",
  errorCode: "error_code",
  errorMessage: "error_message",
};

/**
 * Applies what web-nf reports to one row, idempotently. Runs inside the caller's transaction,
 * under the restaurant's context. Also settles a cancel request when web-nf reports the
 * `cancelamento` event as rejected or failed: the error goes on the row and the request is
 * cleared, so the admin can try again.
 */
export async function applyInvoiceUpdate(
  tx: Tx,
  restaurantId: string,
  orderInvoiceId: string,
  incoming: IncomingWithEvents,
  now: Date = new Date(),
): Promise<ApplyInvoiceResult> {
  const row = await loadInvoiceRow(tx, restaurantId, orderInvoiceId, true);
  if (row === undefined) return { changed: false, found: false, from: null, status: null };

  const decision = decideInvoiceUpdate(
    {
      status: row.status,
      numero: row.numero,
      serie: row.serie,
      chaveAcesso: row.chave_acesso,
      errorCode: row.error_code,
      errorMessage: row.error_message,
    },
    incoming,
  );
  const set: Record<string, unknown> = {};
  if (decision.apply) {
    for (const [key, value] of Object.entries(decision.patch)) set[COLUMN[key as keyof InvoicePatch]] = value;
  }
  const status = (decision.apply ? decision.patch.status : undefined) ?? row.status;

  const cancel = latestCancelOutcome(incoming.events);
  if (
    status === "authorized" &&
    row.cancel_requested_at !== null &&
    cancel !== null &&
    (cancel.status === "rejected" || cancel.status === "failed")
  ) {
    set.error_code = cancel.status === "rejected" ? "cancel_rejected" : "cancel_failed";
    set.error_message = cancel.error
      ? describeSefazRejection(cancel.error.code, cancel.error.message).slice(0, 500)
      : "O serviço fiscal não conseguiu cancelar a nota. Tente novamente.";
    set.cancel_requested_at = null;
    set.cancel_requested_by = null;
    set.cancel_reason = null;
  }

  const columns = Object.keys(set);
  if (columns.length === 0) return { changed: false, found: true, from: row.status, status: row.status };
  await tx`
    update public.order_invoices set ${tx(set, ...columns)}
    where restaurant_id = ${restaurantId} and id = ${orderInvoiceId}
  `;
  if (status !== row.status) {
    await emitInvoiceUpdated(tx, restaurantId, orderInvoiceId, now);
    if (status === "authorized") await recordUsage(tx, restaurantId, "invoice.issued", orderInvoiceId, now);
  }
  return { changed: true, found: true, from: row.status, status };
}

/**
 * FR-134: queues `invoice.updated` for the restaurant's webhook endpoint, in the caller's
 * transaction. Call it on every status change. Never carries XML or PDF URLs (06.api-spec.md).
 */
export async function emitInvoiceUpdated(
  tx: Tx,
  restaurantId: string,
  orderInvoiceId: string,
  now: Date,
): Promise<void> {
  const row = await loadInvoiceRow(tx, restaurantId, orderInvoiceId);
  if (row === undefined) return;
  await emitEvent(
    tx,
    restaurantId,
    "invoice.updated",
    {
      invoice: {
        id: row.id,
        order_id: row.order_id,
        kind: row.kind,
        status: row.status,
        numero: row.numero,
        serie: row.serie,
        chave_acesso: row.chave_acesso,
        error_code: row.error_code,
        error_message: row.error_message,
        updated_at: row.updated_at.toISOString(),
      },
    },
    { now },
  );
}
