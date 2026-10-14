// Public API menu, read-only in v1 (06.api-spec.md "Menu"; FR-050..FR-059, FR-142).
// Archived items are hidden. Fiscal overrides (`ncm`, `cfop`) are not exposed.

import { listMenuQuerySchema } from "@mt/schemas";

import { defineService } from "../../service";
import { likePattern } from "../orders/shared";
import { decodeKeysetCursor, type Page, pageOf } from "./cursor";
import type { ApiMenuItem } from "./views";

interface MenuRow extends Omit<ApiMenuItem, "sizes"> {
  created_at: Date;
}

export const apiListMenu = defineService({
  name: "api.menu.list",
  minRole: "attendant",
  input: listMenuQuerySchema,
  run: async ({ tx, ctx, input }): Promise<Page<ApiMenuItem>> => {
    const after = decodeKeysetCursor(input.cursor);
    const pattern = input.q ? likePattern(input.q) : null;
    const rows = await tx<MenuRow[]>`
      select id, kind, name, description, category, price_cents, calories, volume, available, popular,
             available_weekdays, image_url, created_at
      from public.menu_items
      where restaurant_id = ${ctx.restaurantId} and archived_at is null
        ${input.kind ? tx`and kind = ${input.kind}` : tx``}
        ${input.available !== undefined ? tx`and available = ${input.available}` : tx``}
        ${input.weekday !== undefined ? tx`and ${input.weekday}::smallint = any(available_weekdays)` : tx``}
        ${pattern ? tx`and name ilike ${pattern}` : tx``}
        ${after ? tx`and (created_at, id) < (${after.createdAt}::timestamptz, ${after.id}::uuid)` : tx``}
      order by created_at desc, id desc
      limit ${input.limit + 1}
    `;
    const shownIds = rows.slice(0, input.limit).map((r) => r.id);
    const sizes =
      shownIds.length === 0
        ? []
        : await tx<{ id: string; menu_item_id: string; name: string; price_cents: number; position: number }[]>`
            select id, menu_item_id, name, price_cents, position from public.menu_item_sizes
            where restaurant_id = ${ctx.restaurantId} and menu_item_id in ${tx(shownIds)}
            order by position, name
          `;
    return pageOf(rows, input.limit, ({ created_at: _createdAt, ...item }) => ({
      ...item,
      price_cents: Number(item.price_cents),
      available_weekdays: [...item.available_weekdays],
      sizes: sizes
        .filter((s) => s.menu_item_id === item.id)
        .map((s) => ({ id: s.id, name: s.name, price_cents: Number(s.price_cents), position: s.position })),
    }));
  },
});
