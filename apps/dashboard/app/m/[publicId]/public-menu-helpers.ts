// Pure helpers for the public menu page /m/{public_id} (ADR-030, FR-223).

import type { PublicMenuItemDto } from "@mt/http";

import {
  DISPLAY_WEEKDAYS,
  DRINK_CATEGORY_LABELS,
  MEAL_CATEGORY_LABELS,
  WEEKDAY_LABELS,
} from "@/app/(app)/menu/menu-helpers";

export interface PublicMenuSection {
  readonly category: string;
  readonly label: string;
  readonly items: readonly PublicMenuItemDto[];
}

/** Items of one kind, grouped in the category order of the menu screen. Unknown categories go last. */
export function groupByCategory(
  items: readonly PublicMenuItemDto[],
  kind: PublicMenuItemDto["kind"],
): PublicMenuSection[] {
  const labels = kind === "meal" ? MEAL_CATEGORY_LABELS : DRINK_CATEGORY_LABELS;
  const order = Object.keys(labels);
  const byCategory = new Map<string, PublicMenuItemDto[]>();
  for (const item of items) {
    if (item.kind !== kind) continue;
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }
  const rank = (c: string) => (order.includes(c) ? order.indexOf(c) : order.length);
  return [...byCategory.entries()]
    .sort(([x], [y]) => rank(x) - rank(y))
    .map(([category, list]) => ({ category, label: labels[category] ?? category, items: list }));
}

export function isOfferedOn(item: PublicMenuItemDto, weekday: number): boolean {
  return item.availableWeekdays.includes(weekday);
}

/** "Todos os dias", or the weekdays Monday first: "Seg, Qua, Sex". */
export function weekdaysText(weekdays: readonly number[]): string {
  if (DISPLAY_WEEKDAYS.every((d) => weekdays.includes(d))) return "Todos os dias";
  return DISPLAY_WEEKDAYS.filter((d) => weekdays.includes(d))
    .map((d) => WEEKDAY_LABELS[d])
    .join(", ");
}

/** The lowest price a customer can pay: the smallest size, or the base price when there are no sizes. */
export function startingPriceCents(item: PublicMenuItemDto): number {
  return item.sizes.length === 0 ? item.priceCents : Math.min(...item.sizes.map((s) => s.priceCents));
}

/**
 * `https://wa.me/{digits}` for a display phone such as "(11) 99999-0000". A Brazilian number
 * with area code (10 or 11 digits) gets the country code 55. Returns null when the phone has
 * too few digits to dial.
 */
export function whatsappLink(phone: string | null): string | null {
  if (phone === null) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  const international = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${international}`;
}

/** FR-238, ADR-032: the chat with the restaurant, with the order text typed in. */
export function whatsappOrderLink(phone: string | null, text: string): string | null {
  const base = whatsappLink(phone);
  return base === null ? null : `${base}?text=${encodeURIComponent(text)}`;
}
