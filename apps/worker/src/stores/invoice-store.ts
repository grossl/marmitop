// DbInvoiceJobStore: the InvoiceJobStore over Postgres (05.data-model.md "order_invoices",
// 08.fiscal-mapping.md section 6). Every method is its own short transaction under the
// restaurant's `system` context (RLS treats it as admin, so the cancel guard trigger lets the
// worker settle a cancel). No transaction stays open across a web-nf call.

import type { InvoiceRequestBody, InvoiceView } from "@mt/core";
import { type Tx, withRestaurantContext } from "@mt/db";
import {
  applyInvoiceUpdate,
  emitInvoiceUpdated,
  enqueueInvoiceJob,
  loadFiscalConnection,
  loadInvoiceRow,
  markFiscalIntegrationError,
  type ServiceDeps,
  systemCtx,
  toDbContext,
} from "@mt/http";

import type { CancelLoad, InvoiceJobStore, IssueLoad, PollLoad } from "../handlers/invoice-jobs";

const NON_FINAL = ["queued", "received", "processing"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** FR-125: the worker checks the frozen body again before it calls web-nf. */
export function checkFrozenPayload(payload: unknown, row: { id: string; kind: string }): string | null {
  if (!isRecord(payload)) return "request_payload";
  if (payload.kind !== row.kind) return "request_payload.kind";
  if (payload.reference !== row.id) return "request_payload.reference";
  const body = payload[row.kind];
  if (!isRecord(body)) return `request_payload.${row.kind}`;
  if (!Array.isArray(body.itens) || body.itens.length === 0) return `request_payload.${row.kind}.itens`;
  if (!Array.isArray(body.pagamentos) || body.pagamentos.length === 0) return `request_payload.${row.kind}.pagamentos`;
  return null;
}

export class DbInvoiceJobStore implements InvoiceJobStore {
  constructor(private readonly deps: ServiceDeps) {}

  private tx<T>(restaurantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRestaurantContext(this.deps.db, toDbContext(systemCtx(restaurantId)), fn, this.deps.contextOptions);
  }

  private async connection(tx: Tx, restaurantId: string) {
    const conn = await loadFiscalConnection(tx, this.deps, restaurantId);
    if (conn === null || conn.status === "disconnected") return null;
    return { baseUrl: conn.baseUrl, apiKey: conn.apiKey };
  }

  loadIssue(restaurantId: string, orderInvoiceId: string): Promise<IssueLoad> {
    return this.tx(restaurantId, async (tx) => {
      const row = await loadInvoiceRow(tx, restaurantId, orderInvoiceId);
      if (row === undefined || row.status !== "queued" || row.external_id !== null) return { kind: "skip" };
      const problem = checkFrozenPayload(row.request_payload, row);
      if (problem !== null) return { kind: "invalid", reason: problem };
      const connection = await this.connection(tx, restaurantId);
      if (connection === null) return { kind: "not_configured" };
      return { kind: "ready", payload: row.request_payload as InvoiceRequestBody, connection };
    });
  }

  async markSubmitted(
    restaurantId: string,
    orderInvoiceId: string,
    externalId: string,
    status: string,
    pollDelaySeconds: number,
  ): Promise<void> {
    await this.tx(restaurantId, async (tx) => {
      await tx`
        update public.order_invoices set external_id = ${externalId}
        where restaurant_id = ${restaurantId} and id = ${orderInvoiceId} and external_id is null
      `;
      await applyInvoiceUpdate(tx, restaurantId, orderInvoiceId, { status }, this.deps.clock.now());
      await enqueueInvoiceJob(tx, restaurantId, orderInvoiceId, "poll", pollDelaySeconds, 0);
    });
  }

  async markFailed(
    restaurantId: string,
    orderInvoiceId: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    await this.tx(restaurantId, async (tx) => {
      const rows = await tx`
        update public.order_invoices
        set status = 'failed', error_code = ${errorCode.slice(0, 64)}, error_message = ${errorMessage.slice(0, 500)}
        where restaurant_id = ${restaurantId} and id = ${orderInvoiceId} and status in ${tx(NON_FINAL)}
        returning id
      `;
      // FR-134: every status change emits invoice.updated.
      if (rows.length > 0) await emitInvoiceUpdated(tx, restaurantId, orderInvoiceId, this.deps.clock.now());
    });
  }

  async markIntegrationError(restaurantId: string, message: string): Promise<void> {
    await this.tx(restaurantId, (tx) => markFiscalIntegrationError(tx, restaurantId, message));
  }

  loadPoll(restaurantId: string, orderInvoiceId: string): Promise<PollLoad> {
    return this.tx(restaurantId, async (tx) => {
      const row = await loadInvoiceRow(tx, restaurantId, orderInvoiceId);
      if (row === undefined || row.external_id === null) return { kind: "skip" };
      // A final row is polled only while a cancel request waits for its outcome.
      const waitingCancel = row.status === "authorized" && row.cancel_requested_at !== null;
      if (!NON_FINAL.includes(row.status) && !waitingCancel) return { kind: "skip" };
      const connection = await this.connection(tx, restaurantId);
      if (connection === null) return { kind: "not_configured" };
      return { kind: "ready", externalId: row.external_id, connection };
    });
  }

  applyRemote(restaurantId: string, orderInvoiceId: string, view: InvoiceView): Promise<{ status: string | null }> {
    return this.tx(restaurantId, async (tx) => {
      const r = await applyInvoiceUpdate(
        tx,
        restaurantId,
        orderInvoiceId,
        {
          status: view.status,
          numero: view.numero,
          serie: view.serie,
          chaveAcesso: view.chaveAcesso,
          error: view.error,
          ...(view.events ? { events: view.events } : {}),
        },
        this.deps.clock.now(),
      );
      // Keep polling while a cancel request is still open at web-nf.
      const row = await loadInvoiceRow(tx, restaurantId, orderInvoiceId);
      if (row && row.status === "authorized" && row.cancel_requested_at !== null) return { status: "processing" };
      return { status: r.status };
    });
  }

  async schedulePoll(restaurantId: string, orderInvoiceId: string, delaySeconds: number, round: number): Promise<void> {
    await this.tx(restaurantId, (tx) =>
      enqueueInvoiceJob(tx, restaurantId, orderInvoiceId, "poll", delaySeconds, round),
    );
  }

  loadCancel(restaurantId: string, orderInvoiceId: string): Promise<CancelLoad> {
    return this.tx(restaurantId, async (tx) => {
      const row = await loadInvoiceRow(tx, restaurantId, orderInvoiceId);
      if (
        row === undefined ||
        row.status !== "authorized" ||
        row.external_id === null ||
        row.cancel_requested_at === null ||
        row.cancel_reason === null
      ) {
        return { kind: "skip" };
      }
      const connection = await this.connection(tx, restaurantId);
      if (connection === null) return { kind: "not_configured" };
      return {
        kind: "ready",
        externalId: row.external_id,
        justificativa: row.cancel_reason,
        idempotencyKey: `cancel-${row.id}-${row.cancel_requested_at.getTime()}`,
        connection,
      };
    });
  }

  async markCancelFailed(
    restaurantId: string,
    orderInvoiceId: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    const code = (errorCode.startsWith("cancel_") ? errorCode : `cancel_${errorCode}`).slice(0, 64);
    await this.tx(
      restaurantId,
      (tx) => tx`
        update public.order_invoices
        set error_code = ${code}, error_message = ${errorMessage.slice(0, 500)},
            cancel_requested_at = null, cancel_requested_by = null, cancel_reason = null
        where restaurant_id = ${restaurantId} and id = ${orderInvoiceId} and status = 'authorized'
          and cancel_requested_at is not null
      `,
    );
  }
}
