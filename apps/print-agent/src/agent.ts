// One poll of the print agent (FR-254, ADR-038): claim, render, print, report.
// A print error reports `printed: false`; an API error ends the tick, and the
// lease brings the job back. A printed job goes into the local record before the
// report, so a job that comes back after a lost report is not printed twice.
// Logs carry the job id and order code only (NFR-064).

import { encodeEscPos, type OrderTicketInput, renderOrderTicket } from "@mt/core";

import type { ClaimedJob, Logger, PrintedRecord, PrintJobApi, TicketPrinter, WireTicket } from "./ports";

export interface AgentDeps {
  readonly api: PrintJobApi;
  readonly printer: TicketPrinter;
  readonly printed: PrintedRecord;
  readonly log: Logger;
  readonly columns: number;
  /** Waits between report attempts. Tests pass a no-op. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Shared across ticks, so a claim error is logged once until a claim works again. */
  readonly state?: { claimFailing: boolean };
}

export const CLAIM_LIMIT = 5;
const REPORT_ATTEMPTS = 3;
const REPORT_BACKOFF_MS = 1000;

export function toTicketInput(t: WireTicket): OrderTicketInput {
  const o = t.order;
  return {
    restaurantName: t.restaurant_name,
    timezone: t.timezone,
    code: o.code,
    fulfillment: o.fulfillment,
    source: o.source,
    createdAt: new Date(o.created_at),
    customerName: t.customer_name,
    customerPhone: t.customer_phone,
    items: o.items.map((i) => ({
      name: i.name,
      sizeName: i.size_name,
      unitPriceCents: i.unit_price_cents,
      qty: i.qty,
      notes: i.notes,
    })),
    notes: o.notes,
    logradouro: o.logradouro,
    numero: o.numero,
    complemento: o.complemento,
    bairro: o.bairro,
    cidade: o.cidade,
    uf: o.uf,
    cep: o.cep,
    paymentMethod: o.payment_method,
    changeForCents: o.change_for_cents,
    subtotalCents: o.subtotal_cents,
    deliveryFeeCents: o.delivery_fee_cents,
    totalCents: o.total_cents,
  };
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500);

type Result = { printed: true } | { printed: false; error: string };

async function report(deps: AgentDeps, job: ClaimedJob, result: Result): Promise<void> {
  const sleep = deps.sleep ?? Bun.sleep;
  for (let attempt = 1; ; attempt++) {
    try {
      await deps.api.report(job.id, result);
      return;
    } catch (error) {
      if (attempt >= REPORT_ATTEMPTS) {
        // The lease brings the job back; the local record keeps it from printing again.
        deps.log.error("result not reported", {
          job_id: job.id,
          order_code: job.ticket.order.code,
          error: message(error),
        });
        return;
      }
      await sleep(REPORT_BACKOFF_MS * attempt);
    }
  }
}

async function printOne(deps: AgentDeps, job: ClaimedJob): Promise<void> {
  const code = job.ticket.order.code;
  if (deps.printed.has(job.id)) {
    deps.log.info("already printed, reporting only", { job_id: job.id, order_code: code, attempt: job.attempts });
    await report(deps, job, { printed: true });
    return;
  }
  let result: Result;
  try {
    await deps.printer.print(encodeEscPos(renderOrderTicket(toTicketInput(job.ticket), deps.columns)));
    result = { printed: true };
    deps.log.info("ticket printed", { job_id: job.id, order_code: code, attempt: job.attempts });
  } catch (error) {
    result = { printed: false, error: message(error) };
    deps.log.error("print failed", { job_id: job.id, order_code: code, attempt: job.attempts, error: result.error });
  }
  if (result.printed) {
    try {
      deps.printed.add(job.id);
    } catch (error) {
      deps.log.error("printed record not saved", { job_id: job.id, error: message(error) });
    }
  }
  await report(deps, job, result);
}

/** Returns the number of jobs handled in this tick. */
export async function runOnce(deps: AgentDeps): Promise<number> {
  let jobs: ClaimedJob[];
  try {
    jobs = await deps.api.claim(CLAIM_LIMIT);
  } catch (error) {
    if (!deps.state?.claimFailing) deps.log.warn("claim failed, retrying every tick", { error: message(error) });
    if (deps.state) deps.state.claimFailing = true;
    return 0;
  }
  if (deps.state?.claimFailing) {
    deps.state.claimFailing = false;
    deps.log.info("claim works again");
  }
  for (const job of jobs) await printOne(deps, job);
  return jobs.length;
}
