// Money helpers (ADR-006, NFR-041). Money is integer cents everywhere in core.
// Core uses safe-integer `number` for cents; the database column is bigint and
// the db package converts at the edge. Nothing here multiplies or adds reais.

export type Cents = number;

/** Throws unless `value` is a safe integer (negative values pass; callers check sign). */
export function assertCents(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be an integer number of cents`);
  }
  return value;
}

/**
 * Cents to reais for the web-nf payload (08 section 3). The text is built from
 * digits, so no division or multiplication happens on floats. The parse of a
 * two-decimal string gives the double that prints back with two decimals.
 */
export function centsToReais(cents: number | bigint): number {
  const big = typeof cents === "bigint" ? cents : BigInt(assertCents(cents, "cents"));
  if (big < 0n) throw new RangeError("cents must not be negative");
  const whole = big / 100n;
  const frac = (big % 100n).toString().padStart(2, "0");
  return Number(`${whole}.${frac}`);
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Display only (NFR-040). Never feed the result back into a calculation. */
export function formatBRL(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(assertCents(cents, "cents"));
  const text = brl.format(Number(`${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`));
  return sign ? `-${text}` : text;
}
