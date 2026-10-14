// packages/http/src/services/orders/customer-lookup.ts
//
// Customer picker and inline create for the new-order screen (FR-030). Full
// customer CRUD (FR-040..FR-049) lives in services/messaging. These two read
// and create the minimum the picker needs.

import { AppError } from "@mt/core";
import { lookupCustomersActionSchema, quickCreateCustomerActionSchema } from "@mt/schemas";

import { defineService } from "../../service";
import { likePattern } from "./shared";

export interface PickerCustomer {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly cep: string | null;
  readonly logradouro: string | null;
  readonly numero: string | null;
  readonly complemento: string | null;
  readonly bairro: string | null;
  readonly cidade: string | null;
  readonly uf: string | null;
  readonly codigoMunicipio: string | null;
}

interface PickerRow {
  id: string;
  name: string;
  phone: string;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  codigo_municipio: string | null;
}

const toPicker = (r: PickerRow): PickerCustomer => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  cep: r.cep,
  logradouro: r.logradouro,
  numero: r.numero,
  complemento: r.complemento,
  bairro: r.bairro,
  cidade: r.cidade,
  uf: r.uf,
  codigoMunicipio: r.codigo_municipio,
});


/** Up to 30 customers by name or phone, plus any pinned `ids` (for `?customer=<id>`). */
export const lookupCustomers = defineService({
  name: "orders.lookupCustomers",
  minRole: "attendant",
  input: lookupCustomersActionSchema,
  run: async ({ tx, ctx, input }): Promise<PickerCustomer[]> => {
    const term = input.q?.trim();
    const pattern = term ? likePattern(term) : null;
    const ids = input.ids ?? [];
    const rows = await tx<PickerRow[]>`
      select id, name, phone, cep, logradouro, numero, complemento, bairro, cidade, uf, codigo_municipio
      from public.customers
      where restaurant_id = ${ctx.restaurantId}
        and (
          ${pattern ? tx`(name ilike ${pattern} or phone ilike ${pattern})` : tx`true`}
          ${ids.length > 0 ? tx`or id in ${tx(ids)}` : tx``}
        )
      order by (${ids.length > 0 ? tx`id in ${tx(ids)}` : tx`false`}) desc, name
      limit 30
    `;
    return rows.map(toPicker);
  },
});

/** FR-030: name and phone only. A duplicate phone is a `conflict` (FR-047). */
export const quickCreateCustomer = defineService({
  name: "orders.quickCreateCustomer",
  minRole: "attendant",
  input: quickCreateCustomerActionSchema,
  run: async ({ tx, ctx, input }): Promise<PickerCustomer> => {
    const [dup] = await tx<{ id: string }[]>`
      select id from public.customers where restaurant_id = ${ctx.restaurantId} and phone = ${input.phone}`;
    if (dup !== undefined) {
      throw new AppError("conflict", "A customer with this phone already exists.", {
        details: [{ path: "phone", code: "duplicate", message: "Já existe um cliente com este telefone." }],
      });
    }
    const [row] = await tx<PickerRow[]>`
      insert into public.customers (restaurant_id, name, phone)
      values (${ctx.restaurantId}, ${input.name}, ${input.phone})
      returning id, name, phone, cep, logradouro, numero, complemento, bairro, cidade, uf, codigo_municipio
    `;
    if (row === undefined) throw new AppError("forbidden", "Your role cannot perform this action.");
    return toPicker(row);
  },
});
