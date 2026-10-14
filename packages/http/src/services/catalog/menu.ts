// packages/http/src/services/catalog/menu.ts
//
// Menu CRUD (FR-050..FR-059, 06.api-spec.md Appendix A `listMenu`, `saveMenuItem`,
// `deleteMenuItem`, `setMenuItemAvailability`). Reads: admin or attendant (attendants build
// orders from the menu). Writes: admin only. "Excluir" archives (FR-057, ADR-018).

import { AppError } from "@mt/core";
import type { MenuItemRow, MenuItemSizeRow } from "@mt/db";
import {
  deleteMenuItemSchema,
  listMenuItemsSchema,
  saveMenuItemSchema,
  setMenuItemAvailabilitySchema,
} from "@mt/schemas";

import { defineService } from "../../service";

export interface MenuSizeDto {
  readonly id: string;
  readonly name: string;
  readonly priceCents: number;
}

export interface MenuItemDto {
  readonly id: string;
  readonly kind: "meal" | "drink";
  readonly name: string;
  readonly description: string | null;
  readonly category: string;
  readonly priceCents: number;
  readonly calories: number | null;
  readonly volume: string | null;
  readonly available: boolean;
  readonly popular: boolean;
  /** 0 = Sunday .. 6 = Saturday. */
  readonly availableWeekdays: readonly number[];
  readonly imageUrl: string | null;
  readonly ncm: string | null;
  readonly cfop: string | null;
  /** Ordered by `position`. */
  readonly sizes: readonly MenuSizeDto[];
}

type ItemRow = Omit<MenuItemRow, "restaurant_id" | "archived_at" | "created_at" | "updated_at">;
type SizeRow = Pick<MenuItemSizeRow, "id" | "menu_item_id" | "name" | "price_cents">;

const ITEM_COLUMNS = `id, kind, name, description, category, price_cents, calories, volume, available, popular,
  available_weekdays, image_url, ncm, cfop`;

export function toMenuItemDto(row: ItemRow, sizes: readonly SizeRow[]): MenuItemDto {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    description: row.description,
    category: row.category,
    priceCents: row.price_cents,
    calories: row.calories,
    volume: row.volume,
    available: row.available,
    popular: row.popular,
    availableWeekdays: [...row.available_weekdays],
    imageUrl: row.image_url,
    ncm: row.ncm,
    cfop: row.cfop,
    sizes: sizes.map((s) => ({ id: s.id, name: s.name, priceCents: s.price_cents })),
  };
}

export const listMenuItems = defineService({
  name: "menu.list",
  minRole: "attendant",
  input: listMenuItemsSchema,
  run: async ({ tx, ctx, input }): Promise<MenuItemDto[]> => {
    const q = input.q === undefined || input.q === "" ? null : `%${input.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const items = await tx<ItemRow[]>`
      select ${tx.unsafe(ITEM_COLUMNS)}
      from public.menu_items
      where restaurant_id = ${ctx.restaurantId}
        and archived_at is null
        and (${input.kind ?? null}::text is null or kind = ${input.kind ?? null})
        and (${q}::text is null or name ilike ${q} or description ilike ${q})
      order by created_at desc, id
    `;
    if (items.length === 0) return [];
    const sizes = await tx<SizeRow[]>`
      select id, menu_item_id, name, price_cents
      from public.menu_item_sizes
      where restaurant_id = ${ctx.restaurantId} and menu_item_id in ${tx(items.map((i) => i.id))}
      order by position, name
    `;
    return items.map((item) =>
      toMenuItemDto(
        item,
        sizes.filter((s) => s.menu_item_id === item.id),
      ),
    );
  },
});

export const saveMenuItem = defineService({
  name: "menu.save",
  minRole: "admin",
  input: saveMenuItemSchema,
  run: async ({ tx, ctx, input }): Promise<MenuItemDto> => {
    const weekdays = tx.array(input.availableWeekdays as number[], 21);
    let row: ItemRow | undefined;
    if (input.id === undefined) {
      [row] = await tx<ItemRow[]>`
        insert into public.menu_items (restaurant_id, kind, name, description, category, price_cents, calories,
          volume, available, popular, available_weekdays, image_url, ncm, cfop)
        values (${ctx.restaurantId}, ${input.kind}, ${input.name}, ${input.description}, ${input.category},
          ${input.priceCents}, ${input.calories ?? null}, ${input.volume}, ${input.available}, ${input.popular},
          ${weekdays}, ${input.imageUrl}, ${input.ncm}, ${input.cfop})
        returning ${tx.unsafe(ITEM_COLUMNS)}
      `;
    } else {
      // `kind` is not editable: the category and size rules depend on it, and order history names it.
      [row] = await tx<ItemRow[]>`
        update public.menu_items set
          name = ${input.name}, description = ${input.description}, category = ${input.category},
          price_cents = ${input.priceCents}, calories = ${input.calories ?? null}, volume = ${input.volume},
          available = ${input.available}, popular = ${input.popular}, available_weekdays = ${weekdays},
          image_url = ${input.imageUrl}, ncm = ${input.ncm}, cfop = ${input.cfop}
        where id = ${input.id} and restaurant_id = ${ctx.restaurantId} and kind = ${input.kind}
          and archived_at is null
        returning ${tx.unsafe(ITEM_COLUMNS)}
      `;
    }
    // RLS hides the row from a non-admin even when the context claimed admin (second line, ADR-005).
    if (row === undefined) throw new AppError("not_found", "Menu item not found.");
    const itemId = row.id;

    // Sizes are edited with their item and no row references one (05.data-model.md), so the set is replaced.
    await tx`delete from public.menu_item_sizes where menu_item_id = ${itemId} and restaurant_id = ${ctx.restaurantId}`;
    let sizes: SizeRow[] = [];
    if (input.sizes.length > 0) {
      for (const [position, size] of input.sizes.entries()) {
        const [saved] = await tx<SizeRow[]>`
          insert into public.menu_item_sizes (id, restaurant_id, menu_item_id, name, price_cents, position)
          values (coalesce(${size.id ?? null}::uuid, gen_random_uuid()), ${ctx.restaurantId}, ${itemId},
            ${size.name}, ${size.priceCents}, ${position})
          returning id, menu_item_id, name, price_cents
        `;
        if (saved) sizes = [...sizes, saved];
      }
    }
    return toMenuItemDto(row, sizes);
  },
});

/** "Excluir" (FR-057): sets `archived_at`. The item leaves lists and new orders; order items keep their snapshot. */
export const archiveMenuItem = defineService({
  name: "menu.delete",
  minRole: "admin",
  input: deleteMenuItemSchema,
  run: async ({ tx, ctx, input }): Promise<{ id: string }> => {
    const [row] = await tx<{ id: string }[]>`
      update public.menu_items set archived_at = now()
      where id = ${input.id} and restaurant_id = ${ctx.restaurantId} and archived_at is null
      returning id
    `;
    if (row === undefined) throw new AppError("not_found", "Menu item not found.");
    return row;
  },
});

export const setMenuItemAvailability = defineService({
  name: "menu.setAvailability",
  minRole: "admin",
  input: setMenuItemAvailabilitySchema,
  run: async ({ tx, ctx, input }): Promise<{ id: string; available: boolean }> => {
    const [row] = await tx<{ id: string; available: boolean }[]>`
      update public.menu_items set available = ${input.available}
      where id = ${input.id} and restaurant_id = ${ctx.restaurantId} and archived_at is null
      returning id, available
    `;
    if (row === undefined) throw new AppError("not_found", "Menu item not found.");
    return row;
  },
});
