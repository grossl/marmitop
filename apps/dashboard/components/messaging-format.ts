// Pure display helpers for the messages and contacts screens (NFR-040):
// BRL money, dd/mm/aaaa dates, 24-hour times, in the restaurant timezone.
// v1 has one timezone, the settings default; a fixed zone also keeps server
// and browser renders identical.

const TIME_ZONE = "America/Sao_Paulo";

const timeFmt = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TIME_ZONE });
const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TIME_ZONE });
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatBRL(cents: number): string {
  return brl.format(cents / 100);
}

export function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

/** Time today, "Ontem", or the date: the sidebar's timestamp. */
export function formatListTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const date = new Date(iso);
  const day = dateFmt.format(date);
  if (day === dateFmt.format(now)) return timeFmt.format(date);
  if (day === dateFmt.format(new Date(now.getTime() - 86_400_000))) return "Ontem";
  return day;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export const ORDER_STATUS_LABELS: Record<string, string> = {
  aguardando: "Aguardando",
  confirmado: "Confirmado",
  preparando: "Preparando",
  pronto: "Pronto",
  saiu: "Saiu para entrega",
  entregue: "Entregue",
  cancelado: "Cancelado",
};

export const ORDER_STATUS_STYLES: Record<string, string> = {
  aguardando: "bg-yellow-100 text-yellow-700 border-yellow-200",
  confirmado: "bg-blue-100 text-blue-700 border-blue-200",
  preparando: "bg-amber-100 text-amber-700 border-amber-200",
  pronto: "bg-green-100 text-green-700 border-green-200",
  saiu: "bg-purple-100 text-purple-700 border-purple-200",
  entregue: "bg-slate-100 text-slate-600 border-slate-200",
  cancelado: "bg-red-100 text-red-700 border-red-200",
};

export const PAYMENT_LABELS: Record<string, string> = {
  pix: "PIX",
  dinheiro: "Dinheiro",
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
};

/** "Rua A, 10 — Centro, Rio de Janeiro/RJ", skipping empty parts (FR-042). */
export function addressLine(a: {
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
}): string {
  const street = [a.logradouro, a.numero].filter(Boolean).join(", ");
  const streetFull = [street, a.complemento].filter(Boolean).join(" ");
  const city = [a.cidade, a.uf].filter(Boolean).join("/");
  const tail = [a.bairro, city].filter(Boolean).join(", ");
  return [streetFull, tail].filter(Boolean).join(" — ");
}
