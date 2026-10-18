// packages/http/src/services/orders/shared.ts
//
// Row shapes and pure helpers shared by the orders services (FR-020..FR-039).
// Money is integer cents (ADR-006). Dates leave as ISO strings so a result
// crosses the Server Action boundary unchanged.

import { allowedTargets, type Fulfillment, type InvoiceStatusValue, type OrderStatus } from "@mt/core";
import type { Tx } from "@mt/db";

import type { OrderInvoiceView } from "../invoices/shared";

export type PaymentMethodCode = "pix" | "dinheiro" | "cartao_credito" | "cartao_debito";
export type OrderSourceCode = "counter" | "phone" | "whatsapp" | "api";

export interface OrderItemView {
  readonly name: string;
  readonly sizeName: string | null;
  readonly qty: number;
  readonly unitPriceCents: number;
  readonly lineTotalCents: number;
  readonly notes: string | null;
}

/** One card of the board (FR-020). */
export interface BoardOrder {
  readonly id: string;
  readonly code: string;
  readonly status: OrderStatus;
  readonly fulfillment: Fulfillment;
  /** Where the card can be dropped (core `allowedTargets`, ADR-017). */
  readonly allowedStatuses: readonly OrderStatus[];
  readonly customerId: string;
  readonly customerName: string;
  readonly customerPhone: string;
  readonly addressLine: string;
  readonly paymentMethod: PaymentMethodCode | null;
  readonly changeForCents: number | null;
  readonly notes: string | null;
  readonly subtotalCents: number;
  readonly deliveryFeeCents: number;
  readonly totalCents: number;
  readonly source: OrderSourceCode;
  readonly conversationId: string | null;
  readonly createdAt: string;
  readonly deliveredAt: string | null;
  readonly cancelledAt: string | null;
  /** ADR-020: when the order was paid; null while unpaid. A cancelled order keeps it for the record. */
  readonly paidAt: string | null;
  readonly cancelReason: string | null;
  readonly items: readonly OrderItemView[];
  /** The latest invoice's status, for the card badge (FR-139). Null without an invoice. */
  readonly invoiceStatus: InvoiceStatusValue | null;
  /** FR-193: the AI assistant created the order (`orders.ai_run_id` is set). */
  readonly fromAi: boolean;
}

export interface StatusHistoryView {
  readonly fromStatus: OrderStatus | null;
  readonly toStatus: OrderStatus;
  readonly actorType: "user" | "api_key" | "system";
  readonly changedAt: string;
}

export interface OrderDetail extends BoardOrder {
  readonly cep: string | null;
  readonly logradouro: string | null;
  readonly numero: string | null;
  readonly complemento: string | null;
  readonly bairro: string | null;
  readonly cidade: string | null;
  readonly uf: string | null;
  readonly codigoMunicipio: string | null;
  /** Digits only; the invoice panel offers NF-e when it is a CNPJ (FR-122). */
  readonly customerCpfCnpj: string | null;
  readonly history: readonly StatusHistoryView[];
  /** Newest first (FR-128). */
  readonly invoices: readonly OrderInvoiceView[];
}

export interface AddressParts {
  readonly logradouro?: string | null;
  readonly numero?: string | null;
  readonly complemento?: string | null;
  readonly bairro?: string | null;
  readonly cidade?: string | null;
  readonly uf?: string | null;
  readonly cep?: string | null;
}

/** FR-034: "Rua X, 12 - Apto 3 - Bairro - Cidade/UF". Empty parts drop out. */
export function formatAddressLine(a: AddressParts): string {
  const clean = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
  const street = [clean(a.logradouro), clean(a.numero)].filter(Boolean).join(", ");
  const city = [clean(a.cidade), clean(a.uf)].filter(Boolean).join("/");
  return [street || null, clean(a.complemento), clean(a.bairro), city || null].filter(Boolean).join(" - ");
}

/** Escapes `\`, `%`, and `_` so user text is a literal inside an `ilike` pattern. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export interface OrderRowForView {
  readonly id: string;
  readonly code: string;
  readonly status: OrderStatus;
  readonly fulfillment: Fulfillment;
  readonly customer_id: string;
  readonly customer_name: string;
  readonly customer_phone: string;
  readonly cep: string | null;
  readonly logradouro: string | null;
  readonly numero: string | null;
  readonly complemento: string | null;
  readonly bairro: string | null;
  readonly cidade: string | null;
  readonly uf: string | null;
  readonly payment_method: PaymentMethodCode | null;
  readonly change_for_cents: number | null;
  readonly notes: string | null;
  readonly subtotal_cents: number;
  readonly delivery_fee_cents: number;
  readonly total_cents: number;
  readonly source: OrderSourceCode;
  readonly conversation_id: string | null;
  readonly created_at: Date;
  readonly delivered_at: Date | null;
  readonly cancelled_at: Date | null;
  readonly cancel_reason: string | null;
  readonly paid_at: Date | null;
  /** The latest `order_invoices.status` (P6). */
  readonly invoice_status?: InvoiceStatusValue | null;
  /** `ai_run_id is not null` (FR-193). */
  readonly from_ai?: boolean;
  readonly items: readonly {
    readonly name: string;
    readonly sizeName: string | null;
    readonly qty: number;
    readonly unitPriceCents: number;
    readonly lineTotalCents: number;
    readonly notes: string | null;
  }[];
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toBoardOrder(r: OrderRowForView): BoardOrder {
  return {
    id: r.id,
    code: r.code,
    status: r.status,
    fulfillment: r.fulfillment,
    allowedStatuses: allowedTargets(r.status, r.fulfillment),
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    addressLine: r.fulfillment === "pickup" ? "Retirada no balcão" : formatAddressLine(r),
    paymentMethod: r.payment_method,
    changeForCents: r.change_for_cents,
    notes: r.notes,
    subtotalCents: r.subtotal_cents,
    deliveryFeeCents: r.delivery_fee_cents,
    totalCents: r.total_cents,
    source: r.source,
    conversationId: r.conversation_id,
    createdAt: r.created_at.toISOString(),
    deliveredAt: iso(r.delivered_at),
    cancelledAt: iso(r.cancelled_at),
    paidAt: iso(r.paid_at),
    cancelReason: r.cancel_reason,
    items: r.items,
    invoiceStatus: r.invoice_status ?? null,
    fromAi: r.from_ai === true,
  };
}

/** SELECT list shared by the board and the detail read. `items` is a JSON array ordered by position. */
export function orderViewColumns(tx: Tx) {
  return tx`
  o.id, o.code, o.status, o.fulfillment, o.customer_id,
  c.name as customer_name, c.phone as customer_phone,
  o.cep, o.logradouro, o.numero, o.complemento, o.bairro, o.cidade, o.uf,
  o.payment_method, o.change_for_cents, o.notes,
  o.subtotal_cents, o.delivery_fee_cents, o.total_cents,
  o.source, o.conversation_id, o.created_at, o.delivered_at, o.cancelled_at, o.cancel_reason, o.paid_at, (o.ai_run_id is not null) as from_ai,
  (
    select oi.status from public.order_invoices oi
    where oi.restaurant_id = o.restaurant_id and oi.order_id = o.id
    order by oi.created_at desc, oi.id desc limit 1
  ) as invoice_status,
  coalesce((
    select json_agg(json_build_object(
      'name', i.name, 'sizeName', i.size_name, 'qty', i.qty,
      'unitPriceCents', i.unit_price_cents, 'lineTotalCents', i.line_total_cents, 'notes', i.notes
    ) order by i.position)
    from public.order_items i
    where i.restaurant_id = o.restaurant_id and i.order_id = o.id
  ), '[]'::json) as items
`;
}
