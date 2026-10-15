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

// ─── backend-uatis webhook panel (ADR-021, ADR-023; FR-172, FR-178) ───────────

export type UatisMode = "push" | "pull";
export type PublicUrlReason =
  | "missing"
  | "invalid_url"
  | "not_https"
  | "userinfo_not_allowed"
  | "port_not_allowed"
  | "query_not_allowed"
  | "private_host";

export function uatisModeLabel(mode: UatisMode): string {
  return mode === "push" ? "Push" : "Pull";
}

export function uatisModeExplanation(mode: UatisMode): string {
  return mode === "push"
    ? "O backend-uatis envia cada evento para o Marmitop assim que ele acontece. A cada 5 minutos o Marmitop também lê o feed de eventos para recuperar algum envio perdido."
    : "O Marmitop busca os eventos no backend-uatis a cada poucos segundos, sem URL pública e sem túnel. É o modo usado em desenvolvimento local.";
}

const PUBLIC_URL_REASONS: Record<PublicUrlReason, string> = {
  missing: "não está definida",
  invalid_url: "não é uma URL válida",
  not_https: "não usa https",
  userinfo_not_allowed: "contém usuário ou senha",
  port_not_allowed: "usa uma porta diferente de 443",
  query_not_allowed: "contém query ou fragmento",
  private_host: "aponta para localhost ou para um endereço privado",
};

export function publicUrlReasonText(reason: PublicUrlReason): string {
  return PUBLIC_URL_REASONS[reason];
}

export function uatisNextModeText(status: {
  nextMode: UatisMode;
  publicUrl: { ok: boolean; url: string | null; reason: PublicUrlReason | null };
}): string {
  const name = status.publicUrl.url ? `MT_PUBLIC_URL (${status.publicUrl.url})` : "MT_PUBLIC_URL";
  const why = status.publicUrl.ok
    ? "é uma URL pública https"
    : publicUrlReasonText(status.publicUrl.reason ?? "missing");
  return `Ao ativar, o modo será ${uatisModeLabel(status.nextMode)}: ${name} ${why}.`;
}
