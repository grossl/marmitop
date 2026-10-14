// refreshInvoice, getInvoiceFiles, cancelInvoice, listOrderInvoices
// (06.api-spec.md Appendix A; FR-127..FR-130, FR-135, FR-138; ADR-003, ADR-015, ADR-016).
//
// refreshInvoice and getInvoiceFiles are open to the attendant, but the web-nf key is an
// admin-only secret (RLS on `secrets`). So they run in three short steps, not one
// `defineService` transaction:
//   1. read the row as the caller (RLS decides whether the caller sees it)
//   2. unseal the key under the restaurant's `system` context; call web-nf with no
//      transaction open (10 s timeout)
//   3. apply the answer under the `system` context (`applyInvoiceUpdate`)
// The signed file URLs go back to the caller and nowhere else: not stored, not logged (FR-138).

import {
  AppError,
  cancelWindowWarning,
  GatewayError,
  type InvoiceKind,
  type InvoiceStatusValue,
  type InvoiceView,
  mapWebNfError,
} from "@mt/core";
import { type Tx, withRestaurantContext } from "@mt/db";
import { cancelInvoiceSchema, orderInvoiceRefSchema, parseOrThrow, uuidSchema } from "@mt/schemas";
import { z } from "zod";

import { requireRole } from "../../auth/roles";
import { type ServiceContext, toDbContext } from "../../context";
import type { ServiceDeps } from "../../deps";
import { defineService } from "../../service";
import { writeAudit } from "../admin/internal";
import { systemCtx } from "../whatsapp/connection";
import {
  applyInvoiceUpdate,
  enqueueInvoiceJob,
  listOrderInvoices,
  loadFiscalConnection,
  loadInvoiceRow,
  markFiscalIntegrationError,
  type OrderInvoiceView,
  toInvoiceView,
} from "./shared";

const inContext = <T>(deps: ServiceDeps, ctx: ServiceContext, fn: (tx: Tx) => Promise<T>) =>
  withRestaurantContext(deps.db, toDbContext(ctx), fn, deps.contextOptions);

export interface InvoiceFiles {
  readonly invoice: OrderInvoiceView;
  /** Short-lived signed URLs from web-nf. Null when the file does not exist (08 section 6.1, Q4). */
  readonly xmlUrl: string | null;
  readonly pdfUrl: string | null;
  /** From web-nf; drives the NFC-e cancel warning (FR-130). */
  readonly authorizedAt: string | null;
  /** The cancel dialog text (FR-130); null for an NF-e. */
  readonly cancelWarning: string | null;
}

/** The pt-BR text for a failed web-nf read, as an AppError the dashboard shows. */
function remoteError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof GatewayError) {
    const f = e.failure;
    const status = f.kind === "http" ? f.status : 0;
    const code = f.kind === "http" ? f.code : undefined;
    return new AppError("upstream_error", mapWebNfError(status, code).message, { httpStatus: 502 });
  }
  return new AppError("upstream_error", "O serviço fiscal está indisponível. Tentaremos novamente.", {
    httpStatus: 502,
  });
}

async function fetchRemote(
  deps: ServiceDeps,
  ctx: ServiceContext,
  orderInvoiceId: string,
): Promise<{ view: InvoiceView | null; row: OrderInvoiceView; kind: InvoiceKind }> {
  // 1. as the caller
  const row = await inContext(deps, ctx, (tx) => loadInvoiceRow(tx, ctx.restaurantId, orderInvoiceId));
  if (row === undefined) throw new AppError("not_found", "Invoice not found.");
  if (row.external_id === null) return { view: null, row: toInvoiceView(row), kind: row.kind };

  // 2. the key under the system context, the call outside any transaction
  const system = systemCtx(ctx.restaurantId);
  const conn = await inContext(deps, system, (tx) => loadFiscalConnection(tx, deps, ctx.restaurantId));
  if (conn === null || conn.status === "disconnected") {
    throw new AppError("fiscal_not_configured", "Configure a integração fiscal em Configurações.");
  }
  let view: InvoiceView;
  try {
    view = await deps.gateways.invoices({ baseUrl: conn.baseUrl, apiKey: conn.apiKey }).getInvoice(row.external_id);
  } catch (e) {
    if (e instanceof GatewayError && e.failure.kind === "http" && e.failure.status === 401) {
      const message = mapWebNfError(401, "unauthorized").message;
      await inContext(deps, system, (tx) => markFiscalIntegrationError(tx, ctx.restaurantId, message));
    }
    throw remoteError(e);
  }

  // 3. apply under the system context; read back as the caller would see it
  const updated = await inContext(deps, system, async (tx) => {
    await applyInvoiceUpdate(
      tx,
      ctx.restaurantId,
      orderInvoiceId,
      {
        status: view.status,
        numero: view.numero,
        serie: view.serie,
        chaveAcesso: view.chaveAcesso,
        error: view.error,
        ...(view.events ? { events: view.events } : {}),
      },
      deps.clock.now(),
    );
    return loadInvoiceRow(tx, ctx.restaurantId, orderInvoiceId);
  });
  if (updated === undefined) throw new AppError("not_found", "Invoice not found.");
  return { view, row: toInvoiceView(updated), kind: updated.kind };
}

/** Manual poll (Appendix A `refreshInvoice`, FR-127). Attendant and admin. */
export async function refreshInvoice(
  deps: ServiceDeps,
  ctx: ServiceContext,
  rawInput: z.input<typeof orderInvoiceRefSchema>,
): Promise<OrderInvoiceView> {
  requireRole(ctx, "attendant");
  const input = parseOrThrow(orderInvoiceRefSchema, rawInput);
  return (await fetchRemote(deps, ctx, input.orderInvoiceId)).row;
}
refreshInvoice.serviceName = "invoices.refresh";

/** Fresh signed XML and PDF URLs on each call, never stored (FR-129, ADR-003). Attendant and admin. */
export async function getInvoiceFiles(
  deps: ServiceDeps,
  ctx: ServiceContext,
  rawInput: z.input<typeof orderInvoiceRefSchema>,
): Promise<InvoiceFiles> {
  requireRole(ctx, "attendant");
  const input = parseOrThrow(orderInvoiceRefSchema, rawInput);
  const { view, row, kind } = await fetchRemote(deps, ctx, input.orderInvoiceId);
  const authorizedAt = view?.authorizedAt ?? null;
  return {
    invoice: row,
    xmlUrl: view?.files?.xml ?? null,
    pdfUrl: view?.files?.pdf ?? null,
    authorizedAt,
    cancelWarning: cancelWindowWarning(kind, authorizedAt, deps.clock.now()),
  };
}
getInvoiceFiles.serviceName = "invoices.files";

/**
 * Admin only (FR-130, FR-135, ADR-015). Records the request on the row (the guard trigger
 * checks the role again) and enqueues `mt_invoice_jobs` op `cancel`. web-nf answers the event
 * later; the poll or the `event.*` webhook settles the row.
 */
export const cancelInvoice = defineService({
  name: "invoices.cancel",
  minRole: "admin",
  input: cancelInvoiceSchema,
  run: async ({ tx, ctx, input }): Promise<OrderInvoiceView> => {
    const row = await loadInvoiceRow(tx, ctx.restaurantId, input.orderInvoiceId, true);
    if (row === undefined) throw new AppError("not_found", "Invoice not found.");
    if (row.status !== ("authorized" satisfies InvoiceStatusValue) || row.external_id === null) {
      throw new AppError("invoice_not_allowed", "Only an authorized invoice can be cancelled.");
    }
    if (row.cancel_requested_at !== null) {
      throw new AppError("conflict", "A cancellation is already in progress.");
    }
    const userId = ctx.actorType === "user" ? ctx.userId : null;
    await tx`
      update public.order_invoices
      set cancel_requested_at = now(), cancel_requested_by = ${userId}, cancel_reason = ${input.justificativa},
          error_code = null, error_message = null
      where restaurant_id = ${ctx.restaurantId} and id = ${input.orderInvoiceId}
    `;
    await enqueueInvoiceJob(tx, ctx.restaurantId, input.orderInvoiceId, "cancel");
    await writeAudit(tx, ctx, {
      action: "invoice.cancel_requested",
      entityType: "order_invoice",
      entityId: input.orderInvoiceId,
      context: { kind: row.kind },
    });
    const updated = await loadInvoiceRow(tx, ctx.restaurantId, input.orderInvoiceId);
    if (updated === undefined) throw new AppError("not_found", "Invoice not found.");
    return toInvoiceView(updated);
  },
});

/** The invoices of one order, newest first (order detail panel, FR-128). */
export const getOrderInvoices = defineService({
  name: "invoices.listForOrder",
  minRole: "attendant",
  input: z.object({ orderId: uuidSchema }),
  run: ({ tx, ctx, input }) => listOrderInvoices(tx, ctx.restaurantId, input.orderId),
});
