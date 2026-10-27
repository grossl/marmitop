// Display helpers for the orders screens. Pure and client-safe (@mt/core pulls
// node:crypto, so the browser bundle does not import it). Money is integer
// cents in data; this is display only (NFR-040).

export const PAYMENT_LABELS: Record<string, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  cartao_credito: "Cartão Crédito",
  cartao_debito: "Cartão Débito",
};

/** FR-188: an order with no method shows "A definir". */
export function paymentLabel(method: string | null): string {
  return method === null ? "A definir" : (PAYMENT_LABELS[method] ?? method);
}

export const STATUS_LABELS: Record<string, string> = {
  aguardando: "Aguardando",
  confirmado: "Confirmado",
  pronto: "Pronto",
  saiu: "Saiu para Entrega",
  finalizado: "Finalizado",
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

// ─── Invoices (08.fiscal-mapping.md section 8.4; FR-122, FR-125, FR-128, FR-132, FR-139) ───

export type InvoiceTone = "green" | "blue" | "red" | "amber" | "grey";

const PENDING_INVOICE = new Set(["queued", "received", "processing"]);
const INVOICE_LABELS: Record<string, { label: string; tone: InvoiceTone }> = {
  rejected: { label: "Rejeitada", tone: "red" },
  denied: { label: "Denegada", tone: "red" },
  failed: { label: "Falhou", tone: "amber" },
  cancelled: { label: "Cancelada", tone: "grey" },
};

/** `received`, `queued`, and `processing` all read "Em processamento" (08 section 6). */
export function invoiceBadge(status: string, kind?: string): { label: string; tone: InvoiceTone } {
  if (status === "authorized") {
    const label = kind === "nfe" ? "NF-e emitida" : kind === "nfce" ? "NFC-e emitida" : "NF emitida";
    return { label, tone: "green" };
  }
  if (PENDING_INVOICE.has(status)) return { label: "Em processamento", tone: "blue" };
  return INVOICE_LABELS[status] ?? { label: status, tone: "grey" };
}

export const INVOICE_TONE_CLASSES: Record<InvoiceTone, string> = {
  green: "bg-green-50 dark:bg-green-500/15 text-green-700 dark:text-green-300 border-green-200 dark:border-green-500/30",
  blue: "bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30",
  red: "bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30",
  amber: "bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30",
  grey: "bg-slate-100 dark:bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-500/30",
};

export const isInvoicePending = (status: string) => PENDING_INVOICE.has(status);

/** FR-132: one live invoice per order; after a final non-authorized one, issue again. */
export function canIssueInvoice(latestStatus: string | null): boolean {
  return latestStatus === null || !(PENDING_INVOICE.has(latestStatus) || latestStatus === "authorized");
}

export const isCnpj = (doc: string | null | undefined): boolean => !!doc && /^\d{14}$/.test(doc);

/** Labels for the "complete the data" form, by problem path (FR-125). */
export const MISSING_FIELD_LABELS: Record<string, string> = {
  "customer.cpf_cnpj": "CPF/CNPJ",
  "address.cep": "CEP",
  "address.logradouro": "Rua",
  "address.numero": "Número",
  "address.bairro": "Bairro",
  "address.cidade": "Cidade",
  "address.uf": "UF",
  "address.codigo_municipio": "Código IBGE do município",
  paymentMethod: "Forma de pagamento",
};

/** Problem path to the `fill` key of `issueInvoice`. */
export function fillKey(path: string): string {
  const field = path.split(".").pop() ?? path;
  return field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function formatChave(chave: string): string {
  return chave.replace(/(\d{4})(?=\d)/g, "$1 ");
}
