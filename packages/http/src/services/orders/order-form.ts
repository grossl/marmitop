// packages/http/src/services/orders/order-form.ts
//
// Everything the new-order screen needs in one read (FR-031..FR-035): the
// products offered today and the restaurant's order settings. The server
// still re-checks all of it in `createOrder` (ADR-006).

import { weekdayInTimezone } from "@mt/core";
import { z } from "zod";

import { defineService } from "../../service";
import { loadOrderSettings } from "./order-settings";

export interface FormProductSize {
  readonly id: string;
  readonly name: string;
  readonly priceCents: number;
}

export interface FormProduct {
  readonly id: string;
  readonly kind: "meal" | "drink";
  readonly name: string;
  readonly category: string;
  readonly volume: string | null;
  readonly priceCents: number;
  readonly sizes: readonly FormProductSize[];
}

export interface OrderFormData {
  readonly allowPickup: boolean;
  readonly deliveryFeeCents: number;
  readonly cidade: string | null;
  readonly uf: string | null;
  readonly codigoMunicipio: string | null;
  /** 0 = Sunday, in the restaurant timezone. */
  readonly weekday: number;
  readonly products: readonly FormProduct[];
}

/** FR-032: available items offered on today's weekday, not archived. */
export const getOrderFormData = defineService({
  name: "orders.formData",
  minRole: "attendant",
  input: z.undefined(),
  run: async ({ tx, ctx, deps }): Promise<OrderFormData> => {
    const settings = await loadOrderSettings(tx, ctx.restaurantId);
    const weekday = weekdayInTimezone(deps.clock.now(), settings.timezone);
    const items = await tx<
      { id: string; kind: "meal" | "drink"; name: string; category: string; volume: string | null; price_cents: number }[]
    >`
      select id, kind, name, category, volume, price_cents
      from public.menu_items
      where restaurant_id = ${ctx.restaurantId}
        and archived_at is null and available
        and ${weekday}::smallint = any (available_weekdays)
      order by kind, category, name
    `;
    const sizes =
      items.length === 0
        ? []
        : await tx<{ id: string; menu_item_id: string; name: string; price_cents: number }[]>`
            select id, menu_item_id, name, price_cents from public.menu_item_sizes
            where restaurant_id = ${ctx.restaurantId} and menu_item_id in ${tx(items.map((i) => i.id))}
            order by position, name
          `;
    return {
      allowPickup: settings.allowPickup,
      deliveryFeeCents: settings.deliveryFeeCents,
      cidade: settings.cidade,
      uf: settings.uf,
      codigoMunicipio: settings.codigoMunicipio,
      weekday,
      products: items.map((i) => ({
        id: i.id,
        kind: i.kind,
        name: i.name,
        category: i.category,
        volume: i.volume,
        priceCents: i.price_cents,
        sizes: sizes
          .filter((s) => s.menu_item_id === i.id)
          .map((s) => ({ id: s.id, name: s.name, priceCents: s.price_cents })),
      })),
    };
  },
});
