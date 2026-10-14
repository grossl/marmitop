// Invoice lifecycle rules shared by the worker poll, the web-nf webhook, and the dashboard
// (08.fiscal-mapping.md sections 6 and 8, ADR-016; FR-126..FR-131, FR-136). Pure.

import { AppError } from "../errors";
import {
  describeSefazRejection,
  FINAL_INVOICE_STATUSES,
  type InvoiceStatusValue,
  INVOICE_STATUS_LABELS,
  mapWebNfError,
} from "./error-mapping";
import type { InvoiceKind } from "./invoice-request";

/** The columns of `order_invoices` an update may touch. */
export interface InvoiceRowState {
  readonly status: InvoiceStatusValue;
  readonly numero: number | null;
  readonly serie: number | null;
  readonly chaveAcesso: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

/** What web-nf says, from a `GET /v1/invoices/{id}` or a webhook body. */
export interface IncomingInvoiceState {
  readonly status: string;
  readonly numero?: number | null;
  readonly serie?: number | null;
  readonly chaveAcesso?: string | null;
  readonly error?: { readonly code: string; readonly message: string } | null;
}

export type InvoicePatch = { -readonly [K in keyof InvoiceRowState]?: InvoiceRowState[K] };

export type InvoiceUpdateDecision = { readonly apply: false } | { readonly apply: true; readonly patch: InvoicePatch };

const MAX_ERROR_MESSAGE = 500;
const NON_FINAL_RANK: Readonly<Record<string, number>> = { queued: 0, received: 1, processing: 2 };
const ERROR_STATUSES: readonly string[] = ["rejected", "denied", "failed"];

const isKnown = (s: string): s is InvoiceStatusValue => Object.hasOwn(INVOICE_STATUS_LABELS, s);
const isFinal = (s: InvoiceStatusValue) => FINAL_INVOICE_STATUSES.includes(s);

/**
 * The idempotent status rule (FR-136, 08 section 6). A non-final status moves forward only. A final
 * status never moves back; the only final-to-final move is `authorized` to `cancelled`. The same
 * final status again only fills fields that are still empty. An empty patch is `apply: false`.
 */
export function decideInvoiceUpdate(current: InvoiceRowState, incoming: IncomingInvoiceState): InvoiceUpdateDecision {
  if (!isKnown(incoming.status)) return { apply: false };
  const next = incoming.status;
  let status: InvoiceStatusValue;
  if (!isFinal(current.status)) {
    const forward = isFinal(next) || (NON_FINAL_RANK[next] ?? 0) >= (NON_FINAL_RANK[current.status] ?? 0);
    if (!forward) return { apply: false };
    status = next;
  } else if (next === current.status) {
    status = current.status;
  } else if (current.status === "authorized" && next === "cancelled") {
    status = next;
  } else {
    return { apply: false };
  }

  const patch: InvoicePatch = {};
  if (status !== current.status) patch.status = status;
  const fill = <K extends "numero" | "serie" | "chaveAcesso">(key: K, value: InvoiceRowState[K] | undefined) => {
    if (value !== undefined && value !== null && value !== current[key]) patch[key] = value;
  };
  fill("numero", incoming.numero);
  fill("serie", incoming.serie);
  fill("chaveAcesso", incoming.chaveAcesso);

  if (ERROR_STATUSES.includes(status) && incoming.error) {
    const message = incoming.error.message.slice(0, MAX_ERROR_MESSAGE);
    if (incoming.error.code !== current.errorCode) patch.errorCode = incoming.error.code;
    if (message !== current.errorMessage) patch.errorMessage = message;
  } else if (status === "authorized" && status !== current.status) {
    if (current.errorCode !== null) patch.errorCode = null;
    if (current.errorMessage !== null) patch.errorMessage = null;
  }
  return Object.keys(patch).length === 0 ? { apply: false } : { apply: true, patch };
}

// ---------------------------------------------------------------------------
// web-nf webhook body (06.api-spec.md; web-nf apps/worker/src/pipeline/webhook-fanout.ts)
// ---------------------------------------------------------------------------

export interface NfWebhookEvent {
  readonly type: string;
  readonly deliveryId: string | null;
  readonly invoice: {
    readonly id: string;
    readonly status: string | null;
    readonly numero: number | null;
    readonly chaveAcesso: string | null;
    /** Marmitop sends `order_invoices.id` as the reference (08 section 3.1). */
    readonly reference: string | null;
  };
  /** Present on `event.*` deliveries: the cancel or CC-e event. */
  readonly event: { readonly id: string; readonly type: string; readonly status: string } | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);

const invalid = (path: string, message: string) =>
  new AppError("validation_failed", "The webhook body is invalid.", {
    details: [{ path, code: "invalid", message }],
  });

export function parseNfWebhookEvent(body: unknown): NfWebhookEvent {
  if (!isRecord(body)) throw invalid("", "Expected a JSON object.");
  const type = str(body.type);
  if (!type) throw invalid("type", "Missing event type.");
  const data = body.data;
  if (!isRecord(data) || !isRecord(data.invoice)) throw invalid("data.invoice", "Missing invoice.");
  const inv = data.invoice;
  const id = str(inv.id);
  if (!id) throw invalid("data.invoice.id", "Missing invoice id.");
  const ev = isRecord(data.event) ? data.event : null;
  const evId = ev ? str(ev.id) : null;
  const evType = ev ? str(ev.type) : null;
  const evStatus = ev ? str(ev.status) : null;
  return {
    type,
    deliveryId: str(body.id),
    invoice: {
      id,
      status: str(inv.status),
      numero: int(inv.numero),
      chaveAcesso: str(inv.chave_acesso),
      reference: str(inv.reference),
    },
    event: evId && evType && evStatus ? { id: evId, type: evType, status: evStatus } : null,
  };
}

const WEBHOOK_STATUS: Readonly<Record<string, InvoiceStatusValue>> = {
  "invoice.authorized": "authorized",
  "invoice.rejected": "rejected",
  "invoice.denied": "denied",
  "invoice.failed": "failed",
  "invoice.cancelled": "cancelled",
};

/** The status an `invoice.*` delivery reports. `event.*` and unknown types give null: refresh instead. */
export function nfWebhookStatus(type: string): InvoiceStatusValue | null {
  return WEBHOOK_STATUS[type] ?? null;
}

// ---------------------------------------------------------------------------
// Cancel events
// ---------------------------------------------------------------------------

export interface InvoiceEventState {
  readonly type: string;
  readonly status: string;
  readonly error: { readonly code: string; readonly message: string } | null;
}

/** The last `cancelamento` event web-nf reports, or null. */
export function latestCancelOutcome(
  events: readonly InvoiceEventState[] | undefined,
): { readonly status: string; readonly error: InvoiceEventState["error"] } | null {
  const last = [...(events ?? [])].reverse().find((e) => e.type === "cancelamento");
  return last ? { status: last.status, error: last.error } : null;
}

// ---------------------------------------------------------------------------
// Presentation (pt-BR, 08 section 8)
// ---------------------------------------------------------------------------

const NO_ANSWER = "O serviço fiscal não respondeu.";
const TRANSPORT_CODES = new Set(["timeout", "connection_error", "network_error", "upstream_error", "internal_error"]);

/**
 * `error_code` of a row the worker gave up on after transport failures (timeouts, 5xx, network
 * errors exhausted). web-nf may hold an invoice for its key, so "Emitir novamente" resends the
 * same row with the same Idempotency-Key and body instead of creating a new row (08 section 6).
 */
export const AMBIGUOUS_ERROR_CODE = "ambiguous";

/** True for a `failed` row whose outcome at web-nf is unknown (see AMBIGUOUS_ERROR_CODE). */
export function isAmbiguousFailure(row: { readonly status: string; readonly errorCode: string | null }): boolean {
  return row.status === "failed" && row.errorCode === AMBIGUOUS_ERROR_CODE;
}

/** The plain-language hint for an invoice row (FR-131). The UI never shows raw English text. */
export function invoiceErrorText(row: {
  readonly status: string;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}): string | null {
  const code = row.errorCode;
  if (code === null) return null;
  if (code.startsWith("cancel_")) return row.errorMessage ?? "O cancelamento não foi aceito.";
  if (code === AMBIGUOUS_ERROR_CODE) return `${NO_ANSWER} Emitir novamente reenvia a mesma nota, sem duplicar.`;
  if (row.status === "denied") return "Regularize o cadastro do emitente na SEFAZ.";
  if (row.status === "rejected" && /^\d+$/.test(code)) return describeSefazRejection(code, row.errorMessage ?? "");
  if (code === "validation_failed") return row.errorMessage ?? "Dados da nota inválidos.";
  if (TRANSPORT_CODES.has(code)) return NO_ANSWER;
  return mapWebNfError(400, code).message;
}

/** 08 section 6.2: the NFC-e cancellation window is commonly 30 minutes. */
export const CANCEL_WINDOW_MS = 30 * 60_000;

/** The text the cancel dialog shows (FR-130). `authorizedAt` comes from web-nf. */
export function cancelWindowWarning(kind: InvoiceKind, authorizedAt: string | null, now: Date): string | null {
  if (kind !== "nfce") return null;
  const base = "A SEFAZ só aceita o cancelamento de NFC-e em um prazo curto, em geral 30 minutos após a autorização.";
  const at = authorizedAt ? new Date(authorizedAt).getTime() : Number.NaN;
  if (!Number.isNaN(at) && now.getTime() - at > CANCEL_WINDOW_MS) {
    return `${base} Esta nota foi autorizada há mais de 30 minutos, então o cancelamento pode ser rejeitado.`;
  }
  return base;
}
