// packages/http/src/services/printing/print-jobs.ts
//
// The print agent's API (FR-251, FR-252, ADR-038; 06.api-spec.md "Print jobs").
// A claim leases jobs for 2 minutes and carries the ticket data; the agent renders
// and prints, then posts the result. `skip locked` keeps two agents off one job.

import { AppError } from "@mt/core";
import type { PrintJobRow } from "@mt/db";
import { claimPrintJobsBodySchema, printJobResultBodySchema, uuidSchema } from "@mt/schemas";
import { z } from "zod";

import { defineService } from "../../service";
import { DEFAULT_TIMEZONE } from "../orders/order-settings";
import { type ApiOrder, loadApiOrder } from "../public-api/views";

/** A `printing` job whose claim is older than this is claimable again. */
export const PRINT_LEASE_SECONDS = 120;
/** A failed result on this attempt sets `failed` (FR-252). */
export const PRINT_MAX_ATTEMPTS = 5;

export interface PrintTicketData {
  readonly restaurant_name: string;
  readonly timezone: string;
  readonly customer_name: string;
  readonly customer_phone: string | null;
  readonly order: ApiOrder;
}

export interface ApiPrintJob {
  readonly id: string;
  readonly kind: PrintJobRow["kind"];
  readonly status: PrintJobRow["status"];
  readonly attempts: number;
  readonly last_error: string | null;
  readonly created_at: string;
  readonly printed_at: string | null;
  readonly ticket?: PrintTicketData;
}

type JobRow = Pick<
  PrintJobRow,
  "id" | "order_id" | "kind" | "status" | "attempts" | "last_error" | "created_at" | "printed_at"
>;

function toApiPrintJob(r: JobRow): ApiPrintJob {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    attempts: r.attempts,
    last_error: r.last_error,
    created_at: r.created_at.toISOString(),
    printed_at: r.printed_at?.toISOString() ?? null,
  };
}

const jobNotFound = () => new AppError("not_found", "Print job not found.");

export const apiClaimPrintJobs = defineService({
  name: "api.printJobs.claim",
  minRole: "attendant",
  input: claimPrintJobsBodySchema,
  run: async ({ tx, ctx, deps, input }): Promise<{ data: ApiPrintJob[] }> => {
    const now = deps.clock.now();
    const leaseEnd = new Date(now.getTime() - PRINT_LEASE_SECONDS * 1000);
    const rows = await tx<JobRow[]>`
      with picked as (
        select id from public.print_jobs
        where restaurant_id = ${ctx.restaurantId}
          and (status = 'pending' or (status = 'printing' and claimed_at < ${leaseEnd}))
        order by created_at, id
        limit ${input.limit}
        for update skip locked
      )
      update public.print_jobs p
      set status = 'printing', claimed_at = ${now}, attempts = p.attempts + 1
      from picked where p.restaurant_id = ${ctx.restaurantId} and p.id = picked.id
      returning p.id, p.order_id, p.kind, p.status, p.attempts, p.last_error, p.created_at, p.printed_at
    `;
    if (rows.length === 0) return { data: [] };

    const [restaurant] = await tx<{ name: string; timezone: string | null }[]>`
      select r.name, s.timezone from public.restaurants r
      left join public.restaurant_settings s on s.restaurant_id = r.id
      where r.id = ${ctx.restaurantId}
    `;
    const data: ApiPrintJob[] = [];
    for (const row of rows.sort((x, y) => x.created_at.getTime() - y.created_at.getTime())) {
      const order = await loadApiOrder(tx, ctx.restaurantId, row.order_id);
      if (order === null) throw new Error("print job order not readable");
      const [customer] = await tx<{ name: string; phone: string | null }[]>`
        select name, phone from public.customers where restaurant_id = ${ctx.restaurantId} and id = ${order.customer_id}
      `;
      data.push({
        ...toApiPrintJob(row),
        ticket: {
          restaurant_name: restaurant?.name ?? "",
          timezone: restaurant?.timezone ?? DEFAULT_TIMEZONE,
          customer_name: customer?.name ?? "",
          customer_phone: customer?.phone ?? null,
          order,
        },
      });
    }
    return { data };
  },
});

export const apiReportPrintJobResult = defineService({
  name: "api.printJobs.result",
  minRole: "attendant",
  input: printJobResultBodySchema.extend({ id: z.string().max(64) }),
  run: async ({ tx, ctx, deps, input }): Promise<ApiPrintJob> => {
    // Path ids that are not a uuid are 404, like a foreign id.
    if (!uuidSchema.safeParse(input.id).success) throw jobNotFound();
    const [job] = await tx<{ status: PrintJobRow["status"]; attempts: number }[]>`
      select status, attempts from public.print_jobs
      where restaurant_id = ${ctx.restaurantId} and id = ${input.id}
      for update
    `;
    if (job === undefined) throw jobNotFound();
    if (job.status !== "printing") throw new AppError("conflict", "The print job is not being printed.");

    const now = deps.clock.now();
    const [row] = input.printed
      ? await tx<JobRow[]>`
          update public.print_jobs set status = 'printed', printed_at = ${now}, last_error = null
          where restaurant_id = ${ctx.restaurantId} and id = ${input.id}
          returning id, order_id, kind, status, attempts, last_error, created_at, printed_at
        `
      : await tx<JobRow[]>`
          update public.print_jobs
          set status = ${job.attempts >= PRINT_MAX_ATTEMPTS ? "failed" : "pending"},
              last_error = ${input.error?.trim() || "print failed"}, claimed_at = null
          where restaurant_id = ${ctx.restaurantId} and id = ${input.id}
          returning id, order_id, kind, status, attempts, last_error, created_at, printed_at
        `;
    if (row === undefined) throw new AppError("forbidden", "Your role cannot perform this action.");
    return toApiPrintJob(row);
  },
});
