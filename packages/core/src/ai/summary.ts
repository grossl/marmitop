// The order summary the customer confirms (FR-186). Server-rendered: the model never writes it.

import { formatBRL } from "../money";
import type { Fulfillment } from "../order-status";
import type { OrderTotal } from "../order-total";
import type { CartAddress } from "./cart";

export interface SummaryInput {
  readonly total: OrderTotal;
  readonly fulfillment: Fulfillment;
  readonly address: CartAddress;
}

export function formatAddressLine(a: CartAddress): string {
  const street = [a.logradouro, a.numero, a.complemento].filter((p): p is string => p !== null).join(", ");
  return a.bairro ? `${street} — ${a.bairro}` : street;
}

export function renderOrderSummary(input: SummaryInput): string {
  const lines = ["Seu pedido:"];
  for (const it of input.total.items) {
    const name = it.sizeName ? `${it.name} (${it.sizeName})` : it.name;
    lines.push(`${it.qty}x ${name} — ${formatBRL(it.lineTotalCents)}`);
    if (it.notes) lines.push(`   obs: ${it.notes}`);
  }
  if (input.fulfillment === "delivery" && input.total.deliveryFeeCents > 0) {
    lines.push(`Taxa de entrega — ${formatBRL(input.total.deliveryFeeCents)}`);
  }
  lines.push(`*Total: ${formatBRL(input.total.totalCents)}*`);
  lines.push(
    input.fulfillment === "delivery" ? `Entrega: ${formatAddressLine(input.address)}` : "Retirada no restaurante",
  );
  lines.push("", "Posso confirmar o pedido?");
  return lines.join("\n");
}
