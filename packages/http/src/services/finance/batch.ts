// Batch invoice issue (FR-168, FR-169; ADR-020; 06.api-spec.md Appendix A `issueInvoicesBatch`).
// Admin only.
//
// Each order runs the normal `issueInvoice` service in its own transaction, one after another,
// so the batch applies exactly the per-order checks (V1..V14, FR-125) and one blocked order
// never rolls back or stops the others. No transaction stays open across the loop.

import { AppError, type InvoiceProblem } from "@mt/core";
import { withRestaurantContext } from "@mt/db";
import { issueInvoicesBatchSchema, parseOrThrow } from "@mt/schemas";
import type { z } from "zod";

import { requireRole } from "../../auth/roles";
import { type ServiceContext, toDbContext } from "../../context";
import type { ServiceDeps } from "../../deps";
import { issueInvoice } from "../invoices/issue";

export type BatchIssueResult =
  | { readonly orderId: string; readonly code: string | null; readonly outcome: "issued"; readonly invoiceId: string }
  | {
      readonly orderId: string;
      readonly code: string | null;
      readonly outcome: "blocked";
      readonly problems: readonly InvoiceProblem[];
      readonly missingFields: readonly string[];
    }
  | {
      readonly orderId: string;
      readonly code: string | null;
      readonly outcome: "skipped";
      readonly reason: "invoice_active";
    };

export interface BatchIssueSummary {
  readonly results: readonly BatchIssueResult[];
}

const ACTIVE = "invoice_already_active";

export async function issueInvoicesBatch(
  deps: ServiceDeps,
  ctx: ServiceContext,
  rawInput: z.input<typeof issueInvoicesBatchSchema>,
): Promise<BatchIssueSummary> {
  requireRole(ctx, "admin");
  const input = parseOrThrow(issueInvoicesBatchSchema, rawInput);

  // Codes for the result list, read once. A foreign or unknown id simply has no row (RLS).
  const codes = await withRestaurantContext(
    deps.db,
    toDbContext(ctx),
    (tx) => tx<{ id: string; code: string }[]>`
      select id, code from public.orders where restaurant_id = ${ctx.restaurantId} and id in ${tx(input.orderIds)}
    `,
    deps.contextOptions,
  );
  const codeById = new Map(codes.map((r) => [r.id, r.code]));

  const results: BatchIssueResult[] = [];
  for (const orderId of input.orderIds) {
    const code = codeById.get(orderId) ?? null;
    if (code === null) {
      results.push({
        orderId,
        code,
        outcome: "blocked",
        problems: [{ path: "order", code: "not_found", message: "Pedido não encontrado." }],
        missingFields: [],
      });
      continue;
    }
    try {
      const r = await issueInvoice(deps, ctx, { orderId, kind: input.kind });
      if (r.outcome === "queued") {
        results.push({ orderId, code, outcome: "issued", invoiceId: r.invoice.id });
      } else if (r.problems.some((p) => p.code === ACTIVE)) {
        results.push({ orderId, code, outcome: "skipped", reason: "invoice_active" });
      } else {
        results.push({ orderId, code, outcome: "blocked", problems: r.problems, missingFields: r.missingFields });
      }
    } catch (error: unknown) {
      // One order's failure is that order's result; the batch goes on (FR-168).
      const problem: InvoiceProblem =
        error instanceof AppError
          ? { path: "order", code: error.code, message: error.message }
          : { path: "order", code: "unexpected_error", message: "Erro inesperado ao emitir a nota." };
      if (!(error instanceof AppError)) {
        console.error(`finance.issueBatch: order ${orderId} failed: ${(error as Error).name}`);
      }
      results.push({ orderId, code, outcome: "blocked", problems: [problem], missingFields: [] });
    }
  }
  return { results };
}
