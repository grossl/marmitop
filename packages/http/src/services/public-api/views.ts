// Public API objects (06.api-spec.md "Order object", "Customer object", menu item,
// message) in snake_case, and the loaders that read them. The order loader also
// builds the `order.created` webhook payload, so the API and the webhook carry the
// same Order object.

import type { Fulfillment, OrderStatus } from "@mt/core";
import type { Tx } from "@mt/db";

import type { OrderSourceCode, PaymentMethodCode } from "../orders/shared";

export interface ApiOrderItem {
  readonly id: string;
  readonly menu_item_id: string | null;
  readonly name: string;
  readonly size_name: string | null;
  readonly unit_price_cents: number;
  readonly qty: number;
  readonly notes: string | null;
}

export interface ApiOrder {
  readonly id: string;
  readonly code: string;
  readonly status: OrderStatus;
  readonly customer_id: string;
  readonly fulfillment: Fulfillment;
  readonly cep: string | null;
  readonly logradouro: string | null;
  readonly numero: string | null;
  readonly complemento: string | null;
  readonly bairro: string | null;
  readonly cidade: string | null;
  readonly uf: string | null;
  readonly codigo_municipio: string | null;
  readonly payment_method: PaymentMethodCode;
  readonly change_for_cents: number | null;
  readonly notes: string | null;
  readonly subtotal_cents: number;
  readonly delivery_fee_cents: number;
  readonly total_cents: number;
  readonly source: OrderSourceCode;
  readonly conversation_id: string | null;
  readonly items: ApiOrderItem[];
  readonly created_at: string;
  readonly delivered_at: string | null;
}

export interface ApiStatusHistoryEntry {
  readonly from_status: OrderStatus | null;
  readonly to_status: OrderStatus;
  readonly changed_by: string | null;
  readonly changed_at: string;
}

export interface ApiOrderDetail extends ApiOrder {
  readonly status_history: ApiStatusHistoryEntry[];
}

export interface ApiOrderRow {
  id: string;
  code: string;
  status: OrderStatus;
  customer_id: string;
  fulfillment: Fulfillment;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  codigo_municipio: string | null;
  payment_method: PaymentMethodCode;
  change_for_cents: number | null;
  notes: string | null;
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  source: OrderSourceCode;
  conversation_id: string | null;
  items: ApiOrderItem[];
  created_at: Date;
  delivered_at: Date | null;
}

/** SELECT list for `public.orders o`. `items` is a JSON array ordered by position. */
export function apiOrderColumns(tx: Tx) {
  return tx`
    o.id, o.code, o.status, o.customer_id, o.fulfillment,
    o.cep, o.logradouro, o.numero, o.complemento, o.bairro, o.cidade, o.uf, o.codigo_municipio,
    o.payment_method, o.change_for_cents, o.notes, o.subtotal_cents, o.delivery_fee_cents, o.total_cents,
    o.source, o.conversation_id, o.created_at, o.delivered_at,
    coalesce((
      select json_agg(json_build_object(
        'id', i.id, 'menu_item_id', i.menu_item_id, 'name', i.name, 'size_name', i.size_name,
        'unit_price_cents', i.unit_price_cents, 'qty', i.qty, 'notes', i.notes
      ) order by i.position, i.id)
      from public.order_items i
      where i.restaurant_id = o.restaurant_id and i.order_id = o.id
    ), '[]'::json) as items
  `;
}

export function toApiOrder(r: ApiOrderRow): ApiOrder {
  return {
    id: r.id,
    code: r.code,
    status: r.status,
    customer_id: r.customer_id,
    fulfillment: r.fulfillment,
    cep: r.cep,
    logradouro: r.logradouro,
    numero: r.numero,
    complemento: r.complemento,
    bairro: r.bairro,
    cidade: r.cidade,
    uf: r.uf,
    codigo_municipio: r.codigo_municipio,
    payment_method: r.payment_method,
    change_for_cents: r.change_for_cents === null ? null : Number(r.change_for_cents),
    notes: r.notes,
    subtotal_cents: Number(r.subtotal_cents),
    delivery_fee_cents: Number(r.delivery_fee_cents),
    total_cents: Number(r.total_cents),
    source: r.source,
    conversation_id: r.conversation_id,
    items: r.items.map((i) => ({ ...i, unit_price_cents: Number(i.unit_price_cents) })),
    created_at: r.created_at.toISOString(),
    delivered_at: r.delivered_at?.toISOString() ?? null,
  };
}

export async function loadApiOrder(tx: Tx, restaurantId: string, orderId: string): Promise<ApiOrder | null> {
  const [row] = await tx<ApiOrderRow[]>`
    select ${apiOrderColumns(tx)} from public.orders o
    where o.restaurant_id = ${restaurantId} and o.id = ${orderId}
  `;
  return row === undefined ? null : toApiOrder(row);
}

export async function loadApiStatusHistory(
  tx: Tx,
  restaurantId: string,
  orderId: string,
): Promise<ApiStatusHistoryEntry[]> {
  const rows = await tx<
    { from_status: OrderStatus | null; to_status: OrderStatus; changed_by: string | null; changed_at: Date }[]
  >`
    select from_status, to_status, changed_by, changed_at from public.order_status_history
    where restaurant_id = ${restaurantId} and order_id = ${orderId}
    order by changed_at, id
  `;
  return rows.map((h) => ({
    from_status: h.from_status,
    to_status: h.to_status,
    changed_by: h.changed_by,
    changed_at: h.changed_at.toISOString(),
  }));
}

// ---------------------------------------------------------------------------

export interface ApiCustomer {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly email: string | null;
  readonly cpf_cnpj: string | null;
  readonly cep: string | null;
  readonly logradouro: string | null;
  readonly numero: string | null;
  readonly complemento: string | null;
  readonly bairro: string | null;
  readonly cidade: string | null;
  readonly uf: string | null;
  readonly codigo_municipio: string | null;
  readonly notes: string | null;
  readonly orders_count: number;
  readonly total_spent_cents: number;
  readonly created_at: string;
}

export interface ApiCustomerRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  cpf_cnpj: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  codigo_municipio: string | null;
  notes: string | null;
  orders_count: number;
  total_spent_cents: number;
  created_at: Date;
}

/** Same totals rule as the dashboard (FR-044, ADR-015): count skips cancelado, spent counts entregue. */
export function apiCustomerColumns(tx: Tx) {
  return tx`
    c.id, c.name, c.phone, c.email, c.cpf_cnpj, c.cep, c.logradouro, c.numero, c.complemento, c.bairro,
    c.cidade, c.uf, c.codigo_municipio, c.notes, c.created_at,
    (select count(*)::int from public.orders o
      where o.restaurant_id = c.restaurant_id and o.customer_id = c.id and o.status <> 'cancelado') as orders_count,
    (select coalesce(sum(o.total_cents), 0)::bigint from public.orders o
      where o.restaurant_id = c.restaurant_id and o.customer_id = c.id and o.status = 'entregue') as total_spent_cents
  `;
}

export function toApiCustomer(r: ApiCustomerRow): ApiCustomer {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    cpf_cnpj: r.cpf_cnpj,
    cep: r.cep,
    logradouro: r.logradouro,
    numero: r.numero,
    complemento: r.complemento,
    bairro: r.bairro,
    cidade: r.cidade,
    uf: r.uf,
    codigo_municipio: r.codigo_municipio,
    notes: r.notes,
    orders_count: Number(r.orders_count),
    total_spent_cents: Number(r.total_spent_cents),
    created_at: r.created_at.toISOString(),
  };
}

export async function loadApiCustomer(tx: Tx, restaurantId: string, customerId: string): Promise<ApiCustomer | null> {
  const [row] = await tx<ApiCustomerRow[]>`
    select ${apiCustomerColumns(tx)} from public.customers c
    where c.restaurant_id = ${restaurantId} and c.id = ${customerId}
  `;
  return row === undefined ? null : toApiCustomer(row);
}

// ---------------------------------------------------------------------------

export interface ApiMenuItem {
  readonly id: string;
  readonly kind: "meal" | "drink";
  readonly name: string;
  readonly description: string | null;
  readonly category: string;
  readonly price_cents: number;
  readonly calories: number | null;
  readonly volume: string | null;
  readonly available: boolean;
  readonly popular: boolean;
  readonly available_weekdays: number[];
  readonly image_url: string | null;
  readonly sizes: { id: string; name: string; price_cents: number; position: number }[];
}

export interface ApiMessage {
  readonly id: string;
  readonly conversation_id: string;
  readonly customer_id: string;
  readonly direction: "in" | "out";
  readonly body: string;
  readonly status: "pending" | "sent" | "delivered" | "read" | "failed";
  readonly order_id: string | null;
  readonly created_at: string;
}

export async function loadApiMessage(tx: Tx, restaurantId: string, messageId: string): Promise<ApiMessage | null> {
  const [row] = await tx<
    {
      id: string;
      conversation_id: string;
      customer_id: string;
      direction: "in" | "out";
      body: string;
      status: ApiMessage["status"];
      order_id: string | null;
      created_at: Date;
    }[]
  >`
    select m.id, m.conversation_id, c.customer_id, m.direction, m.body, m.status, m.order_id, m.created_at
    from public.messages m
    join public.conversations c on c.restaurant_id = m.restaurant_id and c.id = m.conversation_id
    where m.restaurant_id = ${restaurantId} and m.id = ${messageId}
  `;
  return row === undefined ? null : { ...row, created_at: row.created_at.toISOString() };
}
