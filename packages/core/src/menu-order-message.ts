// The WhatsApp text of a public menu order (ADR-032, FR-238). The customer sends it to the
// restaurant, so the conversation starts on their side. Built from the stored order rows:
// the prices are the database prices (ADR-006).

import { formatBRL } from "./money";

export type MenuOrderPaymentMethod = "pix" | "dinheiro" | "cartao_credito" | "cartao_debito";

export interface MenuOrderMessageLine {
  readonly qty: number;
  readonly name: string;
  readonly sizeName: string | null;
  readonly lineTotalCents: number;
}

export interface MenuOrderMessageInput {
  readonly code: string;
  readonly customerName: string;
  readonly lines: readonly MenuOrderMessageLine[];
  readonly subtotalCents: number;
  readonly deliveryFeeCents: number;
  readonly totalCents: number;
  readonly fulfillment: "delivery" | "pickup";
  readonly logradouro: string | null;
  readonly numero: string | null;
  readonly complemento: string | null;
  readonly bairro: string | null;
  readonly paymentMethod: MenuOrderPaymentMethod;
  readonly changeForCents: number | null;
  readonly notes: string | null;
}

const PAYMENT_LABELS: Record<MenuOrderPaymentMethod, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
};

function addressLines(input: MenuOrderMessageInput): string[] {
  const street = [input.logradouro, input.numero].filter(Boolean).join(", ");
  const first = input.complemento ? `${street} — ${input.complemento}` : street;
  return [first, input.bairro ?? ""].filter((l) => l !== "");
}

export function formatMenuOrderMessage(input: MenuOrderMessageInput): string {
  const items = input.lines.map((l) => {
    const name = l.sizeName ? `${l.name} (${l.sizeName})` : l.name;
    return `${l.qty}x ${name} — ${formatBRL(l.lineTotalCents)}`;
  });
  const totals = [`Subtotal: ${formatBRL(input.subtotalCents)}`];
  if (input.fulfillment === "delivery") totals.push(`Entrega: ${formatBRL(input.deliveryFeeCents)}`);
  totals.push(`*Total: ${formatBRL(input.totalCents)}*`);

  const fulfillment =
    input.fulfillment === "delivery" ? ["*Entrega*", ...addressLines(input)] : ["*Retirada no local*"];

  let payment = `Pagamento: ${PAYMENT_LABELS[input.paymentMethod]}`;
  if (input.paymentMethod === "dinheiro" && input.changeForCents !== null) {
    payment += ` (troco para ${formatBRL(input.changeForCents)})`;
  }

  const blocks = [
    ["Olá! Quero fazer um pedido pelo cardápio online.", "", `*Pedido ${input.code}*`, ...items].join("\n"),
    totals.join("\n"),
    fulfillment.join("\n"),
    [payment, ...(input.notes?.trim() ? [`Observações: ${input.notes.trim()}`] : [])].join("\n"),
    `Nome: ${input.customerName}`,
  ];
  // NBSP from Intl currency formatting reads fine in WhatsApp, but a plain space copies better.
  return blocks.join("\n\n").replace(/ /g, " ");
}
