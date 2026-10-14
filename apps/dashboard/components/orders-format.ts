// Display helpers for the orders screens. Pure and client-safe (@mt/core pulls
// node:crypto, so the browser bundle does not import it). Money is integer
// cents in data; this is display only (NFR-040).

export const PAYMENT_LABELS: Record<string, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  cartao_credito: "Cartão Crédito",
  cartao_debito: "Cartão Débito",
};

export const STATUS_LABELS: Record<string, string> = {
  aguardando: "Aguardando",
  confirmado: "Confirmado",
  preparando: "Em Preparo",
  pronto: "Pronto",
  saiu: "Saiu para Entrega",
  entregue: "Entregue",
  cancelado: "Cancelado",
};

const SOURCE_LABELS: Record<string, string> = {
  counter: "Balcão",
  phone: "Telefone",
  whatsapp: "WhatsApp",
  api: "API",
};

export const sourceLabel = (source: string) => SOURCE_LABELS[source] ?? source;

/** "R$ 1.234,56" from integer cents, without float math on the amount. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}R$ ${whole},${String(abs % 100).padStart(2, "0")}`;
}

/** Parses "12,50" or "12.5" to integer cents; null when it is not a money amount. */
export function parseMoneyToCents(text: string): number | null {
  const t = text.trim().replace(/^R\$\s*/, "");
  if (!/^\d+([.,]\d{1,2})?$/.test(t)) return null;
  const [whole = "0", frac = ""] = t.replace(",", ".").split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** "HH:mm" of an ISO instant in the restaurant timezone. */
export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(
    new Date(iso),
  );
}

export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(iso));
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
}
