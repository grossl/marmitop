// Formatting helpers for the admin screens (reports and settings). Pure, client-safe.
// Money is integer cents in data; BRL only in the UI (ADR-006).

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatBRL(cents: number): string {
  return brl.format(cents / 100);
}

/** "6,50", "6.50", "R$ 6,50", "1.234,56" to cents; null when it is not a money amount. */
export function parseBRLToCents(text: string): number | null {
  const cleaned = text.replace(/[R$\s]/g, "");
  if (cleaned === "") return null;
  let normalized = cleaned;
  if (cleaned.includes(",")) normalized = cleaned.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

/** Cents to the "6,50" text of an input. */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-10" to "out/26". */
export function formatMonthLabel(month: string): string {
  const [year, mm] = month.split("-");
  return `${MONTHS[Number(mm) - 1] ?? mm}/${(year ?? "").slice(2)}`;
}

/** "2026-10-13" to "13/10". */
export function formatDayLabel(day: string): string {
  const [, mm, dd] = day.split("-");
  return `${dd}/${mm}`;
}

/** Adds days to a `YYYY-MM-DD` day. */
export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y as number, (m as number) - 1, (d as number) + delta));
  return t.toISOString().slice(0, 10);
}

export const WEEKDAY_NAMES = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;
/** Display order of the hours rows: Monday first, as in the prototype. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** "3 de 300" style usage with a bar percentage capped at 100. */
export function usagePercent(used: number, included: number): number {
  if (included <= 0) return 0;
  return Math.min(100, Math.round((used / included) * 100));
}

export type DeliveryStatus = "pending" | "delivered" | "failed" | "exhausted";

const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  pending: "Pendente",
  delivered: "Entregue",
  failed: "Nova tentativa agendada",
  exhausted: "Esgotada",
};

/** FR-149: the delivery list status column. */
export function deliveryStatusLabel(status: DeliveryStatus): string {
  return DELIVERY_STATUS_LABELS[status];
}

/** FR-149: a pending or failed delivery is already scheduled; only finished ones can be sent again. */
export function canRedeliver(status: DeliveryStatus): boolean {
  return status === "delivered" || status === "exhausted";
}
