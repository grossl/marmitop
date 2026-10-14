// Brazilian identifiers: CPF, CNPJ, CEP, UF, IBGE code, and phone normalization
// (FR-034, FR-045, FR-047, FR-122, FR-125, ADR-016). Pure.

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function allSame(digits: string): boolean {
  return digits.length > 0 && [...digits].every((d) => d === digits[0]);
}

function mod11(digits: string, weights: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += Number(digits[i]) * (weights[i] as number);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

const CPF_W1 = [10, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const CPF_W2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const CNPJ_W1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const CNPJ_W2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

/** CPF with valid check digits. Punctuation is ignored. */
export function isValidCpf(input: string): boolean {
  const d = digitsOnly(input);
  if (d.length !== 11 || allSame(d)) return false;
  const d1 = mod11(d, CPF_W1);
  const d2 = mod11(d.slice(0, 9) + d1, CPF_W2);
  return d === `${d.slice(0, 9)}${d1}${d2}`;
}

/** CNPJ with valid check digits. Punctuation is ignored. */
export function isValidCnpj(input: string): boolean {
  const d = digitsOnly(input);
  if (d.length !== 14 || allSame(d)) return false;
  const d1 = mod11(d, CNPJ_W1);
  const d2 = mod11(d.slice(0, 12) + d1, CNPJ_W2);
  return d === `${d.slice(0, 12)}${d1}${d2}`;
}

/** CEP as stored: exactly 8 digits. */
export function isValidCep(value: string): boolean {
  return /^\d{8}$/.test(value);
}

export const UF_CODES = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;
export type Uf = (typeof UF_CODES)[number];

export function isValidUf(value: string): value is Uf {
  return (UF_CODES as readonly string[]).includes(value);
}

/** IBGE municipality code: 7 digits. */
export function isValidIbgeCode(value: string): boolean {
  return /^\d{7}$/.test(value);
}

/**
 * Normalize a phone number to E.164 (FR-047). A number with a leading `+` keeps its country
 * code. Otherwise Brazil is assumed: 10 or 11 digits get `+55`, and 12 or 13 digits that
 * start with 55 are taken as already carrying the country code. Returns null when impossible.
 */
export function normalizePhoneE164(input: string): string | null {
  const trimmed = input.trim();
  const d = digitsOnly(trimmed);
  if (trimmed.startsWith("+")) {
    return /^[1-9]\d{7,14}$/.test(d) ? `+${d}` : null;
  }
  let full: string | null = null;
  if (d.length === 10 || d.length === 11) full = `55${d}`;
  else if ((d.length === 12 || d.length === 13) && d.startsWith("55")) full = d;
  return full && /^[1-9]\d{7,14}$/.test(full) ? `+${full}` : null;
}
