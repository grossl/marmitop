// Today's menu for the assistant (FR-185, FR-032 rules) and the open check.

import { isOpenAt, type MenuItemForOrder, weekdayInTimezone } from "@mt/core";
import type { Tx } from "@mt/db";

import type { ServiceDeps } from "../../deps";
import { loadAutomationSettings } from "../whatsapp/automatic";

export interface TodayMenu {
  readonly menu: MenuItemForOrder[];
  readonly categories: ReadonlyMap<string, string>;
  readonly weekday: number;
}

/** Available, unarchived items offered on today's weekday in the restaurant's time zone. */
export async function loadTodayMenu(tx: Tx, deps: ServiceDeps, restaurantId: string): Promise<TodayMenu> {
  const { timezone } = await loadAutomationSettings(tx, restaurantId);
  const weekday = weekdayInTimezone(deps.clock.now(), timezone);
  // int8 money comes back as a number (packages/db client.ts, INT8_AS_NUMBER).
  const items = await tx<
    {
      id: string;
      kind: "meal" | "drink";
      name: string;
      category: string;
      price_cents: number;
      available: boolean;
      available_weekdays: number[];
    }[]
  >`
    select id, kind, name, category, price_cents, available, available_weekdays
    from public.menu_items
    where restaurant_id = ${restaurantId} and archived_at is null and available
      and ${weekday} = any(available_weekdays)
    order by kind, category, name
    limit 200
  `;
  const sizes =
    items.length === 0
      ? []
      : await tx<{ id: string; menu_item_id: string; name: string; price_cents: number }[]>`
          select id, menu_item_id, name, price_cents from public.menu_item_sizes
          where restaurant_id = ${restaurantId} and menu_item_id in ${tx(items.map((i) => i.id))}
          order by position, name
        `;
  return {
    weekday,
    categories: new Map(items.map((i) => [i.id, i.category])),
    menu: items.map((i) => ({
      id: i.id,
      kind: i.kind,
      name: i.name,
      priceCents: i.price_cents,
      available: i.available,
      availableWeekdays: i.available_weekdays,
      sizes: sizes
        .filter((s) => s.menu_item_id === i.id)
        .map((s) => ({ id: s.id, name: s.name, priceCents: s.price_cents })),
    })),
  };
}

export async function isRestaurantOpen(tx: Tx, restaurantId: string, now: Date): Promise<boolean> {
  const { hours, timezone } = await loadAutomationSettings(tx, restaurantId);
  return isOpenAt(hours, timezone, now);
}
