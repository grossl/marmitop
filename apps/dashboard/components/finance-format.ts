// Display helpers for the Finance page (ADR-020; FR-164..FR-168). Pure and client-safe.

/** Invoice statuses that hold the order's one live invoice (FR-132): issuing again is skipped. */
const LIVE_INVOICE = new Set(["queued", "received", "processing", "authorized"]);
/** Order statuses that may issue an invoice (FR-121). */
const INVOICEABLE = new Set(["pronto", "saiu", "finalizado"]);

export const INVOICE_STATE_OPTIONS = [
  { value: "all", label: "Todas" },
  { value: "none", label: "Sem nota" },
  { value: "issued", label: "Emitida ou em processamento" },
  { value: "failed", label: "Falhou ou rejeitada" },
] as const;

/** True when "Emitir NF" makes sense for the row: an invoiceable status and no live invoice. */
export function canIssueRow(row: { status: string; invoice: { status: string } | null }): boolean {
  if (!INVOICEABLE.has(row.status)) return false;
  return row.invoice === null || !LIVE_INVOICE.has(row.invoice.status);
}

export interface BatchCounts {
  readonly issued: number;
  readonly blocked: number;
  readonly skipped: number;
}

export function countBatch(results: readonly { outcome: "issued" | "blocked" | "skipped" }[]): BatchCounts {
  const counts = { issued: 0, blocked: 0, skipped: 0 };
  for (const r of results) counts[r.outcome] += 1;
  return counts;
}

/** "01/10 a 31/10/2026" from two `YYYY-MM-DD` days. */
export function formatRange(from: string, to: string): string {
  const [fy, fm, fd] = from.split("-");
  const [ty, tm, td] = to.split("-");
  const left = fy === ty ? `${fd}/${fm}` : `${fd}/${fm}/${fy}`;
  return `${left} a ${td}/${tm}/${ty}`;
}

/** "Nenhum", "1 pedido", "3 pedidos". */
export function pluralOrders(n: number): string {
  if (n === 0) return "Nenhum pedido";
  return n === 1 ? "1 pedido" : `${n} pedidos`;
}
