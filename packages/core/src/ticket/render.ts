// packages/core/src/ticket/render.ts
//
// The kitchen ticket as styled text lines (FR-253, ADR-038). Pure: the print
// agent renders the claimed job, then `encodeEscPos` turns the lines into bytes.
// A double-size line holds half the columns.

import { formatBRL } from "../money";

export interface TicketLine {
  readonly text: string;
  readonly align?: "left" | "center" | "right";
  readonly bold?: boolean;
  readonly size?: "normal" | "double";
}

export type TicketPaymentMethod = "pix" | "dinheiro" | "cartao_credito" | "cartao_debito";
export type TicketSource = "counter" | "phone" | "whatsapp" | "api" | "menu";

export interface OrderTicketItem {
  readonly name: string;
  readonly sizeName: string | null;
  readonly unitPriceCents: number;
  readonly qty: number;
  readonly notes: string | null;
}

export interface OrderTicketInput {
  readonly restaurantName: string;
  /** IANA name; the date and time print in it. */
  readonly timezone: string;
  readonly code: string;
  readonly fulfillment: "delivery" | "pickup";
  readonly source: TicketSource;
  readonly createdAt: Date;
  readonly customerName: string;
  readonly customerPhone: string | null;
  readonly items: readonly OrderTicketItem[];
  readonly notes: string | null;
  readonly logradouro: string | null;
  readonly numero: string | null;
  readonly complemento: string | null;
  readonly bairro: string | null;
  readonly cidade: string | null;
  readonly uf: string | null;
  readonly cep: string | null;
  /** Null for an AI order (FR-188): "A definir". */
  readonly paymentMethod: TicketPaymentMethod | null;
  readonly changeForCents: number | null;
  readonly subtotalCents: number;
  readonly deliveryFeeCents: number;
  readonly totalCents: number;
}

/** 80 mm paper, font A. */
export const TICKET_COLUMNS = 48;

const PAYMENT_LABELS: Record<TicketPaymentMethod, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
};

const SOURCE_LABELS: Record<TicketSource, string> = {
  counter: "Balcão",
  phone: "Telefone",
  whatsapp: "WhatsApp",
  api: "API",
  menu: "Cardápio online",
};

// Intl puts a no-break space after "R$"; the ticket counts it as one column.
const money = (cents: number) => formatBRL(cents).replace(/ /g, " ");

/** Splits `text` into lines of at most `width`, at spaces when it can. */
export function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let rest = word;
      while (rest.length > width) {
        if (line) {
          out.push(line);
          line = "";
        }
        out.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
      if (!rest) continue;
      if (!line) line = rest;
      else if (line.length + 1 + rest.length <= width) line = `${line} ${rest}`;
      else {
        out.push(line);
        line = rest;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/** `left` and `right` on one line; `left` wraps when both do not fit. Later lines indent by `indent`. */
function leftRight(left: string, right: string, width: number, indent = 0): string[] {
  const first = wrapText(left, Math.max(1, width - right.length - 1));
  const head = first[0] ?? "";
  const rest = first.slice(1).join(" ");
  const lines = [`${head}${" ".repeat(Math.max(1, width - head.length - right.length))}${right}`];
  if (rest) lines.push(...wrapText(rest, width - indent).map((l) => `${" ".repeat(indent)}${l}`));
  return lines;
}

/** Brazilian numbers as `(11) 99999-0000`; anything else as stored. */
export function formatTicketPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const local = digits.length >= 12 && digits.startsWith("55") ? digits.slice(2) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return phone;
}

function formatWhen(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

export function renderOrderTicket(input: OrderTicketInput, columns: number = TICKET_COLUMNS): TicketLine[] {
  const half = Math.floor(columns / 2);
  const rule = (ch: string): TicketLine => ({ text: ch.repeat(columns) });
  const plain = (text: string): TicketLine[] => wrapText(text, columns).map((t) => ({ text: t }));
  const lines: TicketLine[] = [];

  for (const t of wrapText(input.restaurantName.toUpperCase(), columns))
    lines.push({ text: t, align: "center", bold: true });
  lines.push(rule("="));
  lines.push({ text: input.code, align: "center", bold: true, size: "double" });
  lines.push({
    text: input.fulfillment === "delivery" ? "ENTREGA" : "RETIRADA",
    align: "center",
    bold: true,
    size: "double",
  });
  lines.push(
    ...leftRight(formatWhen(input.createdAt, input.timezone), SOURCE_LABELS[input.source], columns).map((t) => ({
      text: t,
    })),
  );
  lines.push(rule("-"));

  lines.push(...plain(`Cliente: ${input.customerName || "-"}`));
  if (input.customerPhone) lines.push({ text: `Tel: ${formatTicketPhone(input.customerPhone)}` });
  lines.push(rule("-"));

  for (const item of input.items) {
    const name = `${item.qty}x ${item.name}${item.sizeName ? ` (${item.sizeName})` : ""}`;
    for (const t of leftRight(name, money(item.unitPriceCents * item.qty), columns, 3))
      lines.push({ text: t, bold: true });
    if (item.notes?.trim()) {
      for (const t of wrapText(`obs: ${item.notes.trim()}`, columns - 3)) lines.push({ text: `   ${t}` });
    }
  }

  if (input.notes?.trim()) {
    lines.push(rule("-"));
    lines.push({ text: "OBSERVAÇÕES", bold: true });
    lines.push(...plain(input.notes.trim()));
  }

  if (input.fulfillment === "delivery") {
    lines.push(rule("-"));
    lines.push({ text: "ENDEREÇO", bold: true });
    const street = [input.logradouro, input.numero].filter(Boolean).join(", ");
    if (street) lines.push(...plain(input.complemento ? `${street} - ${input.complemento}` : street));
    const city = [input.cidade, input.uf].filter(Boolean).join("/");
    const area = [input.bairro, city].filter(Boolean).join(" - ");
    if (area) lines.push(...plain(area));
    if (input.cep) lines.push({ text: `CEP ${input.cep.replace(/^(\d{5})(\d{3})$/, "$1-$2")}` });
  }

  lines.push(rule("-"));
  lines.push(...leftRight("Subtotal", money(input.subtotalCents), columns).map((t) => ({ text: t })));
  if (input.fulfillment === "delivery") {
    lines.push(...leftRight("Taxa de entrega", money(input.deliveryFeeCents), columns).map((t) => ({ text: t })));
  }
  lines.push(
    ...leftRight("TOTAL", money(input.totalCents), half).map((t) => ({ text: t, bold: true, size: "double" as const })),
  );
  const payment = input.paymentMethod === null ? "A definir" : PAYMENT_LABELS[input.paymentMethod];
  lines.push(...plain(`Pagamento: ${payment}`));
  if (input.paymentMethod === "dinheiro" && input.changeForCents !== null) {
    lines.push(
      ...plain(`Troco para ${money(input.changeForCents)} (levar ${money(input.changeForCents - input.totalCents)})`),
    );
  }
  return lines;
}
