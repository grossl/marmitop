// Shared field validators and helpers for the request schemas (FR-034, FR-045, FR-047, FR-144).
// Zod 3 API (the dashboard pins zod ^3); the code sticks to calls that also exist in zod 4.

import {
  AppError,
  digitsOnly,
  ERROR_CODES,
  type ErrorDetail,
  isValidCnpj,
  isValidCpf,
  isValidIbgeCode,
  isValidUf,
  normalizePhoneE164,
} from "@mt/core";
import { type ZodError, type ZodTypeAny, z } from "zod";

export {
  isValidCep,
  isValidCnpj,
  isValidCpf,
  isValidIbgeCode,
  isValidUf,
  normalizePhoneE164,
  UF_CODES,
} from "@mt/core";

export const uuidSchema = z.string().uuid();

/** Blank strings and `undefined` become `null`; anything else must satisfy `inner`. */
export function optionalOf<T extends ZodTypeAny>(inner: T) {
  return z
    .preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), inner.nullable().optional())
    .transform((v): z.output<T> | null => (v ?? null) as z.output<T> | null);
}

/** Digits only, 11 digits, valid check digits. Punctuation in the input is dropped. */
export const cpfSchema = z
  .string()
  .trim()
  .regex(/^[\d.\-\s]+$/, "CPF inválido.")
  .transform(digitsOnly)
  .refine(isValidCpf, "CPF inválido.");

export const cnpjSchema = z
  .string()
  .trim()
  .regex(/^[\d.\-/\s]+$/, "CNPJ inválido.")
  .transform(digitsOnly)
  .refine(isValidCnpj, "CNPJ inválido.");

/** CPF or CNPJ, digits out. */
export const cpfCnpjSchema = z
  .string()
  .trim()
  .regex(/^[\d.\-/\s]+$/, "CPF/CNPJ inválido.")
  .transform(digitsOnly)
  .refine((d) => (d.length === 11 && isValidCpf(d)) || (d.length === 14 && isValidCnpj(d)), "CPF/CNPJ inválido.");

/** 8 digits; one hyphen after the fifth digit is accepted on input. */
export const cepSchema = z
  .string()
  .trim()
  .regex(/^\d{5}-?\d{3}$/, "CEP deve ter 8 dígitos.")
  .transform((v) => v.replace("-", ""));

export const ufSchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .refine(isValidUf, "UF inválida.");

export const ibgeCodeSchema = z.string().trim().refine(isValidIbgeCode, "Código do município deve ter 7 dígitos.");

/** Any phone format; the output is E.164 (FR-047). */
export const phoneSchema = z
  .string()
  .trim()
  .min(1, "Informe o telefone.")
  .transform((v, ctx) => {
    const phone = normalizePhoneE164(v);
    if (!phone) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Telefone inválido." });
      return z.NEVER;
    }
    return phone;
  });

export const centsSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** A quantity with at most three decimals (numeric(12,3)). */
export const quantitySchema = z
  .number()
  .finite()
  .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, "No máximo 3 casas decimais.")
  .refine((v) => Math.abs(v) < 1e9, "Valor muito grande.");

export const paginationQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const searchTermSchema = z.string().trim().max(100);

/** The structured address (ADR-016) with the key names of the HTTP API. */
export const addressShapeSnake = {
  cep: optionalOf(cepSchema),
  logradouro: optionalOf(z.string().trim().max(200)),
  numero: optionalOf(z.string().trim().max(20)),
  complemento: optionalOf(z.string().trim().max(100)),
  bairro: optionalOf(z.string().trim().max(100)),
  cidade: optionalOf(z.string().trim().max(100)),
  uf: optionalOf(ufSchema),
  codigo_municipio: optionalOf(ibgeCodeSchema),
};

/** The same fields with the camelCase keys of Server Actions. */
export const addressShapeCamel = {
  cep: addressShapeSnake.cep,
  logradouro: addressShapeSnake.logradouro,
  numero: addressShapeSnake.numero,
  complemento: addressShapeSnake.complemento,
  bairro: addressShapeSnake.bairro,
  cidade: addressShapeSnake.cidade,
  uf: addressShapeSnake.uf,
  codigoMunicipio: addressShapeSnake.codigo_municipio,
};

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), code: z.string(), message: z.string() })).optional(),
  }),
});

function formatPath(path: readonly (string | number)[]): string {
  let out = "";
  for (const part of path) {
    if (typeof part === "number") out += `[${part}]`;
    else out += out === "" ? part : `.${part}`;
  }
  return out;
}

/** Zod issues to the `details[]` of the error envelope: body-relative paths such as `items[0].qty`. */
export function zodErrorToDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    path: formatPath(issue.path),
    code: issue.code === "custom" && typeof issue.params?.code === "string" ? issue.params.code : issue.code,
    message: issue.message,
  }));
}

/** Parse or throw `422 validation_failed` with field paths (FR-144). */
export function parseOrThrow<S extends ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new AppError("validation_failed", "The request body is invalid.", { details: zodErrorToDetails(result.error) });
}
