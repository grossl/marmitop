// packages/http/src/services/catalog/public-menu.ts
//
// The public menu page /m/{public_id} (ADR-030, FR-220–225; ordering: ADR-031). No session and
// no restaurant context: the only read is `mt.public_menu`, a definer function
// that returns the public columns of the available, unarchived items. Not a
// `defineService`: there is no actor and no role to check.

import { type BusinessHoursRow, isOpenAt } from "@mt/core";
import { withoutContext } from "@mt/db";

import type { ServiceDeps } from "../../deps";

/** `restaurants.public_id`, the external id in public links (FR-225). */
export const PUBLIC_ID_PATTERN = /^[0-9a-f]{12}$/;

export interface PublicMenuSizeDto {
  readonly id: string;
  readonly name: string;
  readonly priceCents: number;
}

export interface PublicMenuItemDto {
  readonly id: string;
  readonly kind: "meal" | "drink";
  readonly name: string;
  readonly description: string | null;
  readonly category: string;
  readonly priceCents: number;
  readonly calories: number | null;
  readonly volume: string | null;
  readonly popular: boolean;
  /** 0 = Sunday .. 6 = Saturday. */
  readonly availableWeekdays: readonly number[];
  readonly imageUrl: string | null;
  /** Ordered by `position`. */
  readonly sizes: readonly PublicMenuSizeDto[];
}

export interface PublicMenuDto {
  readonly restaurantName: string;
  readonly phone: string | null;
  readonly timezone: string;
  readonly allowPickup: boolean;
  readonly deliveryFeeCents: number;
  /** Open now, by the business hours in the restaurant timezone (FR-234). */
  readonly openNow: boolean;
  readonly items: readonly PublicMenuItemDto[];
}

interface RawItem {
  id: string;
  kind: "meal" | "drink";
  name: string;
  description: string | null;
  category: string;
  price_cents: number | string;
  calories: number | null;
  volume: string | null;
  popular: boolean;
  available_weekdays: number[];
  image_url: string | null;
  sizes: { id: string; name: string; price_cents: number | string }[];
}

interface RawMenu {
  name: string;
  phone: string | null;
  timezone: string;
  allow_pickup: boolean;
  delivery_fee_cents: number | string;
  hours: { weekday: number; enabled: boolean; opens_at: string; closes_at: string }[];
  items: RawItem[];
}

/** Maps the `mt.public_menu` jsonb. Cents arrive as JSON numbers; `Number` also accepts a string. */
export function toPublicMenuDto(raw: RawMenu, now: Date): PublicMenuDto {
  const hours: BusinessHoursRow[] = raw.hours.map((h) => ({
    weekday: h.weekday,
    enabled: h.enabled,
    opensAt: h.opens_at,
    closesAt: h.closes_at,
  }));
  return {
    restaurantName: raw.name,
    phone: raw.phone,
    timezone: raw.timezone,
    allowPickup: raw.allow_pickup,
    deliveryFeeCents: Number(raw.delivery_fee_cents),
    openNow: isOpenAt(hours, raw.timezone, now),
    items: raw.items.map((i) => ({
      id: i.id,
      kind: i.kind,
      name: i.name,
      description: i.description,
      category: i.category,
      priceCents: Number(i.price_cents),
      calories: i.calories,
      volume: i.volume,
      popular: i.popular,
      availableWeekdays: [...i.available_weekdays],
      imageUrl: i.image_url,
      sizes: i.sizes.map((s) => ({ id: s.id, name: s.name, priceCents: Number(s.price_cents) })),
    })),
  };
}

/** The public menu, or `null` for a malformed or unknown external id (FR-222). */
export async function getPublicMenu(deps: ServiceDeps, publicId: string): Promise<PublicMenuDto | null> {
  if (!PUBLIC_ID_PATTERN.test(publicId)) return null;
  const [row] = await withoutContext(
    deps.db,
    (tx) => tx<{ menu: RawMenu | null }[]>`select mt.public_menu(${publicId}) as menu`,
    "app_service",
  );
  return row?.menu == null ? null : toPublicMenuDto(row.menu, deps.clock.now());
}
