// packages/http/src/services/orders/order-settings.ts
//
// The restaurant facts an order needs: settings (auto-accept, pickup, fee,
// timezone, delivery estimate) and the city defaults for the address
// (FR-029, FR-033, FR-034; the estimate for place_order, FR-187).

import type { Tx } from "@mt/db";

export interface OrderSettings {
  readonly autoAccept: boolean;
  /** FR-240, ADR-035: menu orders move to `confirmado` when created. */
  readonly autoConfirmMenuOrders: boolean;
  readonly allowPickup: boolean;
  readonly deliveryFeeCents: number;
  readonly showDeliveryEstimate: boolean;
  readonly deliveryEstimateMinutes: number;
  readonly timezone: string;
  readonly cidade: string | null;
  readonly uf: string | null;
  readonly codigoMunicipio: string | null;
}

export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

export async function loadOrderSettings(tx: Tx, restaurantId: string): Promise<OrderSettings> {
  const [row] = await tx<
    {
      auto_accept: boolean | null;
      auto_confirm_menu_orders: boolean | null;
      allow_pickup: boolean | null;
      delivery_fee_cents: number | null;
      show_delivery_estimate: boolean | null;
      delivery_estimate_minutes: number | null;
      timezone: string | null;
      cidade: string | null;
      uf: string | null;
      codigo_municipio: string | null;
    }[]
  >`
    select s.auto_accept, s.auto_confirm_menu_orders, s.allow_pickup, s.delivery_fee_cents, s.show_delivery_estimate, s.delivery_estimate_minutes,
      s.timezone, r.cidade, r.uf, r.codigo_municipio
    from public.restaurants r
    left join public.restaurant_settings s on s.restaurant_id = r.id
    where r.id = ${restaurantId}
  `;
  return {
    autoAccept: row?.auto_accept ?? false,
    autoConfirmMenuOrders: row?.auto_confirm_menu_orders ?? false,
    allowPickup: row?.allow_pickup ?? true,
    deliveryFeeCents: row?.delivery_fee_cents ?? 0,
    showDeliveryEstimate: row?.show_delivery_estimate ?? true,
    deliveryEstimateMinutes: row?.delivery_estimate_minutes ?? 45,
    timezone: row?.timezone ?? DEFAULT_TIMEZONE,
    cidade: row?.cidade ?? null,
    uf: row?.uf ?? null,
    codigoMunicipio: row?.codigo_municipio ?? null,
  };
}
