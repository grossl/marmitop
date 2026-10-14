// Pure helpers for the Estoque screen. Quantities are numeric(12,3); money is integer cents (ADR-006).

export const UNIT_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "un", label: "Unidade" },
  { value: "kg", label: "Kg" },
  { value: "l", label: "Litro" },
  { value: "cx", label: "Caixa" },
];

export const MOVEMENT_LABELS: Readonly<Record<string, string>> = {
  in: "Entrada",
  out: "Saída",
  adjust: "Ajuste",
};

/** "1,5", "1.5" or "-2" to a number with at most three decimals. Null for anything else. */
export function parseQty(input: string, { signed }: { signed: boolean }): number | null {
  const text = input.trim().replace(/\s/g, "").replace(",", ".");
  const pattern = signed ? /^-?\d+(\.\d{1,3})?$/ : /^\d+(\.\d{1,3})?$/;
  if (!pattern.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) && Math.abs(value) < 1e9 ? value : null;
}

/** 12 -> "12", 1.5 -> "1,5", 0.125 -> "0,125". */
export function formatQty(qty: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(qty);
}

/** The sign a movement shows in history: `out` is a decrease, `adjust` keeps its own sign. */
export function signedMovementQty(kind: string, qty: number): number {
  return kind === "out" ? -qty : qty;
}

export function formatMovementDelta(kind: string, qty: number): string {
  const delta = signedMovementQty(kind, qty);
  return `${delta > 0 ? "+" : delta < 0 ? "-" : ""}${formatQty(Math.abs(delta))}`;
}
