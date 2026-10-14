// Pure helpers for the Cardápio screen. Money is integer cents in data and BRL only in the UI (ADR-006).

/** 0 = Sunday, as in `menu_items.available_weekdays` (05.data-model.md). */
export const WEEKDAY_LABELS: Readonly<Record<number, string>> = {
  0: "Dom",
  1: "Seg",
  2: "Ter",
  3: "Qua",
  4: "Qui",
  5: "Sex",
  6: "Sáb",
};

/** Display order: Monday first, as the screen always showed. */
export const DISPLAY_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

export const MEAL_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  proteinas: "Proteínas",
  vegetariano: "Vegetariano",
  fit: "Fit & Saudável",
  executiva: "Executiva",
  especial: "Especiais",
};

export const DRINK_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  refrigerantes: "Refrigerantes",
  sucos: "Sucos",
  agua: "Água",
  alcoolicas: "Alcoólicas",
  quentes: "Quentes",
};

export function formatBRL(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const reais = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${sign}${reais},${String(abs % 100).padStart(2, "0")}`;
}

/** "18,90", "18.90" or "18" to 1890. Returns null for anything else (including negatives). */
export function reaisToCents(input: string): number | null {
  const text = input.trim().replace(/\s/g, "");
  if (!/^\d+([.,]\d{1,2})?$/.test(text)) return null;
  const [whole = "0", fraction = ""] = text.replace(",", ".").split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** Cents as the plain "18.90" an `<input type="number">` expects. */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** The lowest size price, or the base price when the item has no sizes (the card's headline price). */
export function headlinePriceCents(item: { priceCents: number; sizes: readonly { priceCents: number }[] }): number {
  return item.sizes.length > 0 ? Math.min(...item.sizes.map((s) => s.priceCents)) : item.priceCents;
}

/** Storage object path for an item image (ADR-017): {restaurant_id}/menu/{menu_item_id}/{uuid}.{ext}. */
export function menuImagePath(
  restaurantId: string,
  menuItemId: string,
  fileId: string,
  mimeType: string,
): string | null {
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[mimeType];
  return ext ? `${restaurantId}/menu/${menuItemId}/${fileId}.${ext}` : null;
}
