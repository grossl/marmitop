// packages/http/src/services/catalog/public-menu.ts
//
// The public menu page /m/{public_id} (ADR-030, FR-220–225). No session and
// no restaurant context: the only read is `mt.public_menu`, a definer function
// that returns the public columns of the available, unarchived items. Not a
// `defineService`: there is no actor and no role to check.

import { withoutContext } from "@mt/db";

import type { ServiceDeps } from "../../deps";

/** `restaurants.public_id`, the external id in public links (FR-225). */
export const PUBLIC_ID_PATTERN = /^[0-9a-f]{12}$/;

export interface PublicMenuSizeDto {
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
  sizes: { name: string; price_cents: number | string }[];
}

interface RawMenu {
  name: string;
  phone: string | null;
  timezone: string;
  items: RawItem[];
}

/** Maps the `mt.public_menu` jsonb. Cents arrive as JSON numbers; `Number` also accepts a string. */
export function toPublicMenuDto(raw: RawMenu): PublicMenuDto {
  return {
    restaurantName: raw.name,
    phone: raw.phone,
    timezone: raw.timezone,
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
      sizes: i.sizes.map((s) => ({ name: s.name, priceCents: Number(s.price_cents) })),
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
  return row?.menu == null ? null : toPublicMenuDto(row.menu);
}
