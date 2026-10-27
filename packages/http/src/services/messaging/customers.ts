// Customers (FR-040..FR-049, 06.api-spec.md Appendix A: listCustomers,
// getCustomer, createCustomer, updateCustomer). Attendant and admin.
// No delete (ADR-018).
//
// Totals: `ordersCount` skips `cancelado` (FR-044). `totalSpentCents` counts
// only `finalizado` orders, the same rule as revenue (ADR-015).

import { AppError } from "@mt/core";
import type { Tx } from "@mt/db";
import {
  createCustomerActionSchema,
  customerIdActionSchema,
  listCustomersActionSchema,
  updateCustomerActionSchema,
} from "@mt/schemas";

import type { z } from "zod";

import type { ServiceContext } from "../../context";
import { defineService } from "../../service";
import { type CustomerOrderSummary, listCustomerOrders } from "./customer-orders";
import { decodeCursor, encodeCursor, likePattern } from "./helpers";

export interface CustomerDto {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly email: string | null;
  readonly cpfCnpj: string | null;
  readonly cep: string | null;
  readonly logradouro: string | null;
  readonly numero: string | null;
  readonly complemento: string | null;
  readonly bairro: string | null;
  readonly cidade: string | null;
  readonly uf: string | null;
  readonly codigoMunicipio: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly ordersCount: number;
  readonly totalSpentCents: number;
}

interface CustomerRow {
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
  created_at: Date;
  orders_count: number;
  total_spent_cents: number;
}

function toDto(row: CustomerRow): CustomerDto {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    cpfCnpj: row.cpf_cnpj,
    cep: row.cep,
    logradouro: row.logradouro,
    numero: row.numero,
    complemento: row.complemento,
    bairro: row.bairro,
    cidade: row.cidade,
    uf: row.uf,
    codigoMunicipio: row.codigo_municipio,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
    ordersCount: row.orders_count,
    totalSpentCents: row.total_spent_cents,
  };
}

/** The columns plus the two totals. `c` is the customers alias. */
const SELECT_CUSTOMER = (tx: Tx) => tx`
  c.id, c.name, c.phone, c.email, c.cpf_cnpj, c.cep, c.logradouro, c.numero, c.complemento, c.bairro,
  c.cidade, c.uf, c.codigo_municipio, c.notes, c.created_at,
  (select count(*) from public.orders o
    where o.restaurant_id = c.restaurant_id and o.customer_id = c.id and o.status <> 'cancelado') as orders_count,
  (select coalesce(sum(o.total_cents), 0)::bigint from public.orders o
    where o.restaurant_id = c.restaurant_id and o.customer_id = c.id and o.status = 'finalizado') as total_spent_cents
`;

async function loadCustomer(tx: Tx, restaurantId: string, customerId: string): Promise<CustomerDto> {
  const [row] = await tx<CustomerRow[]>`
    select ${SELECT_CUSTOMER(tx)} from public.customers c
    where c.restaurant_id = ${restaurantId} and c.id = ${customerId}
  `;
  if (row === undefined) throw new AppError("not_found", "Customer not found.");
  return toDto(row);
}

/** The detail code of a duplicate phone (FR-047). The public API answers it with `409 conflict`. */
export const DUPLICATE_PHONE_CODE = "duplicate_phone";

const DUPLICATE_PHONE = new AppError("validation_failed", "A customer with this phone already exists.", {
  details: [{ path: "phone", code: DUPLICATE_PHONE_CODE, message: "Já existe um cliente com este telefone." }],
});

export const listCustomers = defineService({
  name: "customers.list",
  minRole: "attendant",
  input: listCustomersActionSchema,
  run: async ({ tx, ctx, input }) => {
    const limit = input.limit;
    const offset = decodeCursor(input.cursor);
    const pattern = likePattern(input.q);
    const rows = await tx<CustomerRow[]>`
      select ${SELECT_CUSTOMER(tx)} from public.customers c
      where c.restaurant_id = ${ctx.restaurantId}
        and (${pattern}::text is null
             or c.name ilike ${pattern} or c.phone ilike ${pattern} or c.bairro ilike ${pattern})
      order by c.name, c.id
      limit ${limit + 1} offset ${offset}
    `;
    return {
      items: rows.slice(0, limit).map(toDto),
      nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null,
    };
  },
});

export const getCustomer = defineService({
  name: "customers.get",
  minRole: "attendant",
  input: customerIdActionSchema,
  run: async ({ tx, ctx, input }): Promise<{ customer: CustomerDto; orders: CustomerOrderSummary[] }> => {
    const customer = await loadCustomer(tx, ctx.restaurantId, input.customerId);
    const orders = await listCustomerOrders(tx, ctx.restaurantId, customer.id, 100);
    return { customer, orders };
  },
});

export const createCustomer = defineService({
  name: "customers.create",
  minRole: "attendant",
  input: createCustomerActionSchema,
  run: ({ tx, ctx, input }) => createCustomerInTx(tx, ctx, input),
});

/** The create, in the caller's transaction. `POST /v1/customers` runs it too. */
export async function createCustomerInTx(
  tx: Tx,
  ctx: ServiceContext,
  input: z.output<typeof createCustomerActionSchema>,
): Promise<CustomerDto> {
  const rows = await tx<{ id: string }[]>`
      insert into public.customers
        (restaurant_id, name, phone, email, cpf_cnpj, cep, logradouro, numero, complemento, bairro,
         cidade, uf, codigo_municipio, notes)
      values
        (${ctx.restaurantId}, ${input.name}, ${input.phone}, ${input.email}, ${input.cpfCnpj}, ${input.cep},
         ${input.logradouro}, ${input.numero}, ${input.complemento}, ${input.bairro}, ${input.cidade},
         ${input.uf}, ${input.codigoMunicipio}, ${input.notes})
      on conflict (restaurant_id, phone) do nothing
      returning id
    `;
  const created = rows[0];
  if (created === undefined) {
    // Either the phone exists (FR-047) or RLS hid the insert for this role.
    const [existing] = await tx<{ id: string }[]>`
        select id from public.customers where restaurant_id = ${ctx.restaurantId} and phone = ${input.phone}
      `;
    if (existing !== undefined) throw DUPLICATE_PHONE;
    throw new AppError("forbidden", "Your role cannot perform this action.");
  }
  return loadCustomer(tx, ctx.restaurantId, created.id);
}

const COLUMN_OF = {
  name: "name",
  phone: "phone",
  email: "email",
  cpfCnpj: "cpf_cnpj",
  cep: "cep",
  logradouro: "logradouro",
  numero: "numero",
  complemento: "complemento",
  bairro: "bairro",
  cidade: "cidade",
  uf: "uf",
  codigoMunicipio: "codigo_municipio",
  notes: "notes",
} as const;

/** FR-046: only the fields present in the input change. */
export const updateCustomer = defineService({
  name: "customers.update",
  minRole: "attendant",
  input: updateCustomerActionSchema,
  run: ({ tx, ctx, input }) => updateCustomerInTx(tx, ctx, input),
});

/** The update, in the caller's transaction. `PATCH /v1/customers/{id}` runs it too. */
export async function updateCustomerInTx(
  tx: Tx,
  ctx: ServiceContext,
  input: z.output<typeof updateCustomerActionSchema>,
): Promise<CustomerDto> {
  const current = await loadCustomer(tx, ctx.restaurantId, input.customerId);

  const patch: Record<string, string | null> = {};
  for (const [key, column] of Object.entries(COLUMN_OF)) {
    const value = (input as Record<string, string | null | undefined>)[key];
    if (value !== undefined) patch[column] = value;
  }
  if (patch.name === null) {
    throw new AppError("validation_failed", "The name is required.", {
      details: [{ path: "name", code: "custom", message: "Informe o nome." }],
    });
  }
  if (patch.phone === null) {
    throw new AppError("validation_failed", "The phone is required.", {
      details: [{ path: "phone", code: "custom", message: "Informe o telefone." }],
    });
  }
  if (typeof patch.phone === "string" && patch.phone !== current.phone) {
    const [taken] = await tx<{ id: string }[]>`
        select id from public.customers where restaurant_id = ${ctx.restaurantId} and phone = ${patch.phone}
      `;
    if (taken !== undefined) throw DUPLICATE_PHONE;
  }

  const columns = Object.keys(patch);
  if (columns.length > 0) {
    const rows = await tx<{ id: string }[]>`
        update public.customers set ${tx(patch, ...columns)}
        where id = ${current.id} and restaurant_id = ${ctx.restaurantId}
        returning id
      `;
    if (rows.length === 0) throw new AppError("forbidden", "Your role cannot perform this action.");
  }
  return loadCustomer(tx, ctx.restaurantId, current.id);
}
