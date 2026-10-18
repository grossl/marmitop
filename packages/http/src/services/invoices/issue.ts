// issueInvoice: "Emitir NF" (FR-120..FR-125, FR-132, FR-135; ADR-003, ADR-016;
// 04.architecture.md sequence 5; 08.fiscal-mapping.md sections 1, 3, 6, 7).
//
// One transaction:
//   1. lock the order; apply the "complete the data" form (customer CPF/CNPJ and address)
//   2. run the pre-checks V1..V14 (core `buildInvoiceRequest`) with the new row's id as the
//      web-nf `reference`; on a problem, return the problems and the fields the short form
//      must ask for, and create nothing (FR-125)
//   3. insert `order_invoices` (queued) with the frozen `request_payload` (ADR-016); the
//      partial unique index keeps one live invoice per order (FR-132)
//   4. enqueue `mt_invoice_jobs` op `issue` in the same transaction (ADR-007)

import { randomUUID } from "node:crypto";

import {
  AMBIGUOUS_ERROR_CODE,
  AppError,
  buildInvoiceRequest,
  type FiscalConfig,
  type Fulfillment,
  type InvoiceCustomer,
  type InvoiceMenuItem,
  type InvoiceOrder,
  type InvoiceOrderItem,
  type InvoiceProblem,
  isAmbiguousFailure,
  missingFields,
  type OrderStatus,
  type PaymentMethod,
} from "@mt/core";
import type { Tx } from "@mt/db";
import { issueInvoiceSchema } from "@mt/schemas";
import type { z } from "zod";

import type { ServiceContext } from "../../context";
import { defineService } from "../../service";
import { writeAudit } from "../admin/internal";
import {
  emitInvoiceUpdated,
  enqueueInvoiceJob,
  INVOICE_COLUMNS,
  type InvoiceRow,
  LIVE_INVOICE_STATUSES,
  type OrderInvoiceView,
  toInvoiceView,
} from "./shared";

export type IssueInvoiceResult =
  | { readonly outcome: "queued"; readonly invoice: OrderInvoiceView; readonly warnings: readonly string[] }
  | {
      readonly outcome: "blocked";
      /** V1..V14 problems, pt-BR messages (08 section 7). */
      readonly problems: readonly InvoiceProblem[];
      /** `customer.cpf_cnpj` and `address.*` paths the short form asks for (FR-125). */
      readonly missingFields: readonly string[];
    };

type Fill = NonNullable<z.output<typeof issueInvoiceSchema>["fill"]>;

interface OrderRow {
  code: string;
  status: OrderStatus;
  fulfillment: Fulfillment;
  customer_id: string;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  codigo_municipio: string | null;
  payment_method: PaymentMethod | null;
  change_for_cents: number | null;
  delivery_fee_cents: number;
  total_cents: number;
}

interface CustomerRow {
  name: string;
  cpf_cnpj: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  codigo_municipio: string | null;
}

const ADDRESS_COLUMNS: readonly [keyof Fill, string][] = [
  ["cep", "cep"],
  ["logradouro", "logradouro"],
  ["numero", "numero"],
  ["complemento", "complemento"],
  ["bairro", "bairro"],
  ["cidade", "cidade"],
  ["uf", "uf"],
  ["codigoMunicipio", "codigo_municipio"],
];

/** Writes the short form: CPF/CNPJ and address on the customer; the address on a delivery order too. */
async function applyFill(tx: Tx, restaurantId: string, orderId: string, order: OrderRow, fill: Fill): Promise<void> {
  const address: Record<string, string> = {};
  for (const [key, column] of ADDRESS_COLUMNS) {
    const value = fill[key];
    if (typeof value === "string" && value !== "") address[column] = value;
  }
  const customer: Record<string, string> = { ...address };
  if (fill.cpfCnpj) customer.cpf_cnpj = fill.cpfCnpj;
  const customerColumns = Object.keys(customer);
  if (customerColumns.length > 0) {
    await tx`
      update public.customers set ${tx(customer, ...customerColumns)}
      where restaurant_id = ${restaurantId} and id = ${order.customer_id}
    `;
  }
  if (fill.paymentMethod && order.payment_method === null) {
    await tx`
      update public.orders set payment_method = ${fill.paymentMethod}, change_for_cents = null
      where restaurant_id = ${restaurantId} and id = ${orderId}
    `;
  }
  const orderColumns = Object.keys(address);
  if (order.fulfillment === "delivery" && orderColumns.length > 0) {
    await tx`
      update public.orders set ${tx(address, ...orderColumns)}
      where restaurant_id = ${restaurantId} and id = ${orderId}
    `;
  }
}

async function loadOrder(tx: Tx, restaurantId: string, orderId: string): Promise<OrderRow> {
  const [row] = await tx<OrderRow[]>`
    select code, status, fulfillment, customer_id, cep, logradouro, numero, complemento, bairro, cidade, uf,
           codigo_municipio, payment_method, change_for_cents, delivery_fee_cents, total_cents
    from public.orders where restaurant_id = ${restaurantId} and id = ${orderId}
    for update
  `;
  if (row === undefined) throw new AppError("not_found", "Order not found.");
  return row;
}

async function loadFiscalConfig(tx: Tx, restaurantId: string): Promise<FiscalConfig> {
  const [row] = await tx<
    {
      base_url: string;
      api_key_secret_id: string | null;
      status: string;
      nfce_serie: number;
      nfe_serie: number;
      default_ncm: string;
      default_cfop: string;
      default_csosn: string | null;
      default_pis_cst: string;
      default_cofins_cst: string;
      delivery_fee_mode: "item" | "none";
    }[]
  >`
    select base_url, api_key_secret_id, status, nfce_serie, nfe_serie, default_ncm, default_cfop, default_csosn,
           default_pis_cst, default_cofins_cst, delivery_fee_mode
    from public.integrations_fiscal where restaurant_id = ${restaurantId}
  `;
  if (row === undefined) {
    return {
      baseUrl: null,
      apiKeyConfigured: false,
      nfceSerie: null,
      nfeSerie: null,
      defaultNcm: null,
      defaultCfop: null,
      defaultCsosn: null,
      defaultPisCst: null,
      defaultCofinsCst: null,
      deliveryFeeMode: "item",
    };
  }
  return {
    // A disconnected integration counts as not configured (V1).
    baseUrl: row.status === "disconnected" ? null : row.base_url,
    apiKeyConfigured: row.api_key_secret_id !== null,
    nfceSerie: row.nfce_serie,
    nfeSerie: row.nfe_serie,
    defaultNcm: row.default_ncm,
    defaultCfop: row.default_cfop,
    defaultCsosn: row.default_csosn,
    defaultPisCst: row.default_pis_cst,
    defaultCofinsCst: row.default_cofins_cst,
    deliveryFeeMode: row.delivery_fee_mode,
  };
}

/**
 * When the order's newest invoice is `failed` with `error_code = 'ambiguous'`, put that same row
 * back to `queued` and enqueue `issue` again. The kind and the short form are ignored: the body is
 * frozen, and a changed body under the same key would be a 409 at web-nf. Null otherwise.
 */
async function requeueAmbiguous(
  tx: Tx,
  ctx: ServiceContext,
  now: Date,
  orderId: string,
  orderStatus: OrderStatus,
): Promise<IssueInvoiceResult | null> {
  const restaurantId = ctx.restaurantId;
  const [latest] = await tx<{ id: string; status: string; error_code: string | null }[]>`
    select id, status, error_code from public.order_invoices
    where restaurant_id = ${restaurantId} and order_id = ${orderId}
    order by created_at desc, id desc limit 1
  `;
  if (!latest || !isAmbiguousFailure({ status: latest.status, errorCode: latest.error_code })) return null;
  if (orderStatus === "cancelado") {
    return {
      outcome: "blocked",
      problems: [
        {
          path: "order.status",
          code: "invoice_not_allowed",
          message: "Só é possível emitir nota de pedidos prontos, em entrega ou entregues.",
        },
      ],
      missingFields: [],
    };
  }
  const rows = await tx.unsafe<InvoiceRow[]>(
    `update public.order_invoices set status = 'queued', error_code = null, error_message = null
     where restaurant_id = $1 and id = $2 and status = 'failed' and error_code = $3
       and not exists (
         select 1 from public.order_invoices o
         where o.restaurant_id = $1 and o.order_id = $4 and o.status in ('queued', 'received', 'processing', 'authorized')
       )
     returning ${INVOICE_COLUMNS}`,
    [restaurantId, latest.id, AMBIGUOUS_ERROR_CODE, orderId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  await enqueueInvoiceJob(tx, restaurantId, row.id, "issue");
  await emitInvoiceUpdated(tx, restaurantId, row.id, now);
  await writeAudit(tx, ctx, {
    action: "invoice.resend",
    entityType: "order_invoice",
    entityId: row.id,
    context: { order_id: orderId, kind: row.kind },
  });
  return { outcome: "queued", invoice: toInvoiceView(row), warnings: [] };
}

export const issueInvoice = defineService({
  name: "invoices.issue",
  minRole: "attendant",
  input: issueInvoiceSchema,
  run: async ({ tx, ctx, deps, input }): Promise<IssueInvoiceResult> => {
    const restaurantId = ctx.restaurantId;
    let order = await loadOrder(tx, restaurantId, input.orderId);

    // An ambiguous failure (transport errors exhausted) may exist at web-nf. Resend that row with
    // its key and frozen body: web-nf replays it or creates it once, never twice (08 section 6).
    const resent = await requeueAmbiguous(tx, ctx, deps.clock.now(), input.orderId, order.status);
    if (resent !== null) return resent;

    if (input.fill) {
      await applyFill(tx, restaurantId, input.orderId, order, input.fill);
      order = await loadOrder(tx, restaurantId, input.orderId);
    }

    const [customer] = await tx<CustomerRow[]>`
      select name, cpf_cnpj, cep, logradouro, numero, complemento, bairro, cidade, uf, codigo_municipio
      from public.customers where restaurant_id = ${restaurantId} and id = ${order.customer_id}
    `;
    if (customer === undefined) throw new AppError("not_found", "Customer not found.");
    // ADR-016: new addresses default to the restaurant's city.
    const [place] = await tx<{ cidade: string | null; uf: string | null; codigo_municipio: string | null }[]>`
      select cidade, uf, codigo_municipio from public.restaurants where id = ${restaurantId}
    `;
    const items = await tx<
      { menu_item_id: string | null; name: string; size_name: string | null; unit_price_cents: number; qty: number }[]
    >`
      select menu_item_id, name, size_name, unit_price_cents, qty
      from public.order_items where restaurant_id = ${restaurantId} and order_id = ${input.orderId}
      order by position, id
    `;
    const menuIds = [...new Set(items.map((i) => i.menu_item_id).filter((v): v is string => v !== null))];
    const menuItems =
      menuIds.length === 0
        ? []
        : await tx<{ id: string; kind: "meal" | "drink"; ncm: string | null; cfop: string | null }[]>`
            select id, kind, ncm, cfop from public.menu_items
            where restaurant_id = ${restaurantId} and id in ${tx(menuIds)}
          `;
    const config = await loadFiscalConfig(tx, restaurantId);
    const [active] = await tx<{ n: number }[]>`
      select count(*)::int as n from public.order_invoices
      where restaurant_id = ${restaurantId} and order_id = ${input.orderId} and status in ${tx(LIVE_INVOICE_STATUSES)}
    `;

    const invoiceOrder: InvoiceOrder = {
      code: order.code,
      status: order.status,
      fulfillment: order.fulfillment,
      // An order without a method is checked below; the placeholder never reaches web-nf.
      paymentMethod: order.payment_method ?? "pix",
      changeForCents: order.change_for_cents,
      deliveryFeeCents: order.delivery_fee_cents,
      totalCents: order.total_cents,
      cep: order.cep,
      logradouro: order.logradouro,
      numero: order.numero,
      complemento: order.complemento,
      bairro: order.bairro,
      cidade: order.cidade,
      uf: order.uf,
      codigoMunicipio: order.codigo_municipio,
    };
    const invoiceCustomer: InvoiceCustomer = {
      name: customer.name,
      cpfCnpj: customer.cpf_cnpj,
      cep: customer.cep,
      logradouro: customer.logradouro,
      numero: customer.numero,
      complemento: customer.complemento,
      bairro: customer.bairro,
      cidade: customer.cidade ?? place?.cidade ?? null,
      uf: customer.uf ?? place?.uf ?? null,
      codigoMunicipio: customer.codigo_municipio ?? place?.codigo_municipio ?? null,
    };
    const lines: InvoiceOrderItem[] = items.map((i) => ({
      menuItemId: i.menu_item_id,
      name: i.name,
      sizeName: i.size_name,
      unitPriceCents: i.unit_price_cents,
      qty: i.qty,
    }));
    const menu: InvoiceMenuItem[] = menuItems.map((m) => ({ id: m.id, kind: m.kind, ncm: m.ncm, cfop: m.cfop }));

    const id = randomUUID();
    const built = buildInvoiceRequest(invoiceOrder, lines, invoiceCustomer, config, menu, input.kind, {
      reference: id,
      identifyBuyer: input.identifyBuyer,
      hasActiveInvoice: (active?.n ?? 0) > 0,
    });
    // FR-125, FR-188: an order from the AI assistant may still be "A definir".
    if (order.payment_method === null) {
      const problems: InvoiceProblem[] = [
        ...(built.ok ? [] : built.problems),
        { path: "paymentMethod", code: "required", message: "Informe a forma de pagamento." },
      ];
      return { outcome: "blocked", problems, missingFields: missingFields(problems) };
    }
    if (!built.ok)
      return { outcome: "blocked", problems: built.problems, missingFields: missingFields(built.problems) };

    // A concurrent "Emitir NF" loses on the partial unique index: no row, no job (FR-132).
    const inserted = await tx.unsafe<InvoiceRow[]>(
      `insert into public.order_invoices (id, restaurant_id, order_id, kind, status, request_payload, created_by)
       values ($1, $2, $3, $4, 'queued', $5::text::jsonb, $6)
       on conflict do nothing
       returning ${INVOICE_COLUMNS}`,
      [
        id,
        restaurantId,
        input.orderId,
        input.kind,
        JSON.stringify(built.request),
        ctx.actorType === "user" ? ctx.userId : null,
      ],
    );
    const row = inserted[0];
    if (row === undefined) {
      const problems: InvoiceProblem[] = [
        {
          path: "order",
          code: "invoice_already_active",
          message: "Este pedido já tem uma nota em andamento ou emitida.",
        },
      ];
      return { outcome: "blocked", problems, missingFields: [] };
    }
    await enqueueInvoiceJob(tx, restaurantId, id, "issue");
    // FR-134: the new row's first status is a change too.
    await emitInvoiceUpdated(tx, restaurantId, id, deps.clock.now());
    await writeAudit(tx, ctx, {
      action: "invoice.issue",
      entityType: "order_invoice",
      entityId: id,
      context: { order_id: input.orderId, kind: input.kind },
    });
    return { outcome: "queued", invoice: toInvoiceView(row), warnings: built.warnings };
  },
});
