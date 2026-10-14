// Customer requests (06.api-spec.md "Customers", FR-040..FR-049).

import { z } from "zod";
import {
  addressShapeCamel,
  addressShapeSnake,
  cpfCnpjSchema,
  optionalOf,
  paginationQuerySchema,
  phoneSchema,
  searchTermSchema,
  uuidSchema,
} from "./common";

const nameSchema = z.string().trim().min(1, "Informe o nome.").max(120);
const emailSchema = optionalOf(z.string().trim().email("E-mail inválido.").max(254));
const notesSchema = optionalOf(z.string().trim().max(1000));

const customerShapeSnake = {
  name: nameSchema,
  phone: phoneSchema,
  email: emailSchema,
  cpf_cnpj: optionalOf(cpfCnpjSchema),
  ...addressShapeSnake,
  notes: notesSchema,
};

const customerShapeCamel = {
  name: nameSchema,
  phone: phoneSchema,
  email: emailSchema,
  cpfCnpj: optionalOf(cpfCnpjSchema),
  ...addressShapeCamel,
  notes: notesSchema,
};

/** `POST /v1/customers`. */
export const createCustomerBodySchema = z.object(customerShapeSnake).strict();

/** `PATCH /v1/customers/{id}`. The phone cannot change here: it is the identity (FR-047). */
export const updateCustomerBodySchema = z.object(customerShapeSnake).omit({ phone: true }).partial().strict();

export const createCustomerActionSchema = z.object(customerShapeCamel);

/** FR-046: the dashboard edits every field. A phone change is still checked for duplicates by the service. */
export const updateCustomerActionSchema = z.object(customerShapeCamel).partial().extend({ customerId: uuidSchema });

export const listCustomersQuerySchema = z.object({ q: searchTermSchema.optional() }).merge(paginationQuerySchema);

/** `getCustomer` Server Action (FR-042, FR-043). */
export const customerIdActionSchema = z.object({ customerId: uuidSchema });

/** `listCustomers` Server Action (FR-040, FR-041). */
export const listCustomersActionSchema = listCustomersQuerySchema;
