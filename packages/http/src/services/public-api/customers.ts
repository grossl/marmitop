// Public API customers (06.api-spec.md "Customers"; FR-040..FR-049, FR-142).
// Writes run the dashboard's code paths (`createCustomerInTx`, `updateCustomerInTx`).
// A duplicate phone is `409 conflict` here (06), a field error in the dashboard.

import { AppError } from "@mt/core";
import { createCustomerBodySchema, listCustomersQuerySchema, updateCustomerBodySchema, uuidSchema } from "@mt/schemas";
import { z } from "zod";

import { defineService } from "../../service";
import { createCustomerInTx, DUPLICATE_PHONE_CODE, updateCustomerInTx } from "../messaging/customers";
import { likePattern } from "../orders/shared";
import { decodeKeysetCursor, type Page, pageOf } from "./cursor";
import { type ApiCustomer, type ApiCustomerRow, apiCustomerColumns, loadApiCustomer, toApiCustomer } from "./views";

const customerNotFound = () => new AppError("not_found", "Customer not found.");

/** Path ids that are not a uuid are 404, like a foreign id (the API never confirms existence). */
const pathId = z.string().max(64);
const isUuid = (v: string) => uuidSchema.safeParse(v).success;

function asConflict(error: unknown): never {
  if (error instanceof AppError && error.details?.some((d) => d.code === DUPLICATE_PHONE_CODE)) {
    throw new AppError("conflict", "A customer with this phone already exists.", { details: error.details });
  }
  throw error;
}

export const apiListCustomers = defineService({
  name: "api.customers.list",
  minRole: "attendant",
  input: listCustomersQuerySchema,
  run: async ({ tx, ctx, input }): Promise<Page<ApiCustomer>> => {
    const after = decodeKeysetCursor(input.cursor);
    const pattern = input.q ? likePattern(input.q) : null;
    const rows = await tx<ApiCustomerRow[]>`
      select ${apiCustomerColumns(tx)} from public.customers c
      where c.restaurant_id = ${ctx.restaurantId}
        ${pattern ? tx`and (c.name ilike ${pattern} or c.phone ilike ${pattern} or c.email ilike ${pattern})` : tx``}
        ${after ? tx`and (c.created_at, c.id) < (${after.createdAt}::timestamptz, ${after.id}::uuid)` : tx``}
      order by c.created_at desc, c.id desc
      limit ${input.limit + 1}
    `;
    return pageOf(rows, input.limit, toApiCustomer);
  },
});

export const apiGetCustomer = defineService({
  name: "api.customers.get",
  minRole: "attendant",
  input: z.object({ id: pathId }),
  run: async ({ tx, ctx, input }): Promise<ApiCustomer> => {
    if (!isUuid(input.id)) throw customerNotFound();
    const customer = await loadApiCustomer(tx, ctx.restaurantId, input.id);
    if (customer === null) throw customerNotFound();
    return customer;
  },
});

export const apiCreateCustomer = defineService({
  name: "api.customers.create",
  minRole: "attendant",
  input: createCustomerBodySchema,
  run: async ({ tx, ctx, input }): Promise<ApiCustomer> => {
    const created = await createCustomerInTx(tx, ctx, {
      name: input.name,
      phone: input.phone,
      email: input.email,
      cpfCnpj: input.cpf_cnpj,
      cep: input.cep,
      logradouro: input.logradouro,
      numero: input.numero,
      complemento: input.complemento,
      bairro: input.bairro,
      cidade: input.cidade,
      uf: input.uf,
      codigoMunicipio: input.codigo_municipio,
      notes: input.notes,
    }).catch(asConflict);
    const customer = await loadApiCustomer(tx, ctx.restaurantId, created.id);
    if (customer === null) throw new Error("created customer not readable");
    return customer;
  },
});

const CAMEL_OF: Record<string, string> = { cpf_cnpj: "cpfCnpj", codigo_municipio: "codigoMunicipio" };

/** `PATCH /v1/customers/{id}`: only the fields present change; `phone` cannot change (06). */
export const apiUpdateCustomer = defineService({
  name: "api.customers.update",
  minRole: "attendant",
  input: updateCustomerBodySchema.extend({ id: pathId }),
  run: async ({ tx, ctx, input }): Promise<ApiCustomer> => {
    if (!isUuid(input.id)) throw customerNotFound();
    const { id, ...fields } = input;
    const patch: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) patch[CAMEL_OF[key] ?? key] = value as string | null;
    }
    await updateCustomerInTx(tx, ctx, { customerId: id, ...patch });
    const customer = await loadApiCustomer(tx, ctx.restaurantId, id);
    if (customer === null) throw customerNotFound();
    return customer;
  },
});
