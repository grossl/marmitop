// Prints a sample ticket on MT_PRINTER without the API (11.operations.md "Order ticket printer").

import { encodeEscPos, renderOrderTicket, TICKET_COLUMNS } from "@mt/core";

import { CupsPrinter } from "./cups-printer";

const queue = process.env.MT_PRINTER?.trim();
if (!queue) {
  console.error("Set MT_PRINTER to the CUPS queue name (lpstat -p).");
  process.exit(1);
}
const columns = Number(process.env.MT_PRINT_COLUMNS) || TICKET_COLUMNS;

const lines = renderOrderTicket(
  {
    restaurantName: "Marmitop",
    timezone: "America/Sao_Paulo",
    code: "TESTE",
    fulfillment: "delivery",
    source: "counter",
    createdAt: new Date(),
    customerName: "Cliente de teste",
    customerPhone: "5511999990000",
    items: [
      { name: "Marmita média — frango grelhado", sizeName: "M", unitPriceCents: 2200, qty: 1, notes: "sem cebola" },
      { name: "Refrigerante lata", sizeName: null, unitPriceCents: 600, qty: 2, notes: null },
    ],
    notes: "Teste de impressão: ç ã é ô Ç Õ",
    logradouro: "Rua das Flores",
    numero: "342",
    complemento: null,
    bairro: "Vila Madalena",
    cidade: "São Paulo",
    uf: "SP",
    cep: "05435000",
    paymentMethod: "dinheiro",
    changeForCents: 5000,
    subtotalCents: 3400,
    deliveryFeeCents: 500,
    totalCents: 3900,
  },
  columns,
);
await new CupsPrinter(queue).print(encodeEscPos(lines));
console.log(`Sample ticket sent to ${queue}.`);
