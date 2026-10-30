// One poll of the print agent (FR-254, ADR-038): claim, render, print, report.
// A print error reports `printed: false`; an API error ends the tick, and the
// lease brings the job back. Logs carry the job id and order code only (NFR-064).

import { encodeEscPos, type OrderTicketInput, renderOrderTicket } from "@mt/core";

import type { ClaimedJob, Logger, PrintJobApi, TicketPrinter, WireTicket } from "./ports";

export interface AgentDeps {
  readonly api: PrintJobApi;
  readonly printer: TicketPrinter;
  readonly log: Logger;
  readonly columns: number;
}

const CLAIM_LIMIT = 5;

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

async function printOne(deps: AgentDeps, job: ClaimedJob): Promise<void> {
  const code = job.ticket.order.code;
  let result: { printed: true } | { printed: false; error: string };
  try {
    await deps.printer.print(encodeEscPos(renderOrderTicket(toTicketInput(job.ticket), deps.columns)));
    result = { printed: true };
    deps.log.info("ticket printed", { job_id: job.id, order_code: code, attempt: job.attempts });
  } catch (error) {
    result = { printed: false, error: message(error) };
    deps.log.error("print failed", { job_id: job.id, order_code: code, attempt: job.attempts, error: result.error });
  }
  try {
    await deps.api.report(job.id, result);
  } catch (error) {
    // The lease expires and the job is claimed again; a printed ticket may print twice.
    deps.log.error("result not reported", { job_id: job.id, order_code: code, error: message(error) });
  }
}

/** Returns the number of jobs handled in this tick. */
export async function runOnce(deps: AgentDeps): Promise<number> {
  let jobs: ClaimedJob[];
  try {
    jobs = await deps.api.claim(CLAIM_LIMIT);
  } catch (error) {
    deps.log.warn("claim failed", { error: message(error) });
    return 0;
  }
  for (const job of jobs) await printOne(deps, job);
  return jobs.length;
}
