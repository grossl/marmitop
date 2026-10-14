// packages/http/src/services/orders/order-settings.ts
//
// The restaurant facts an order needs: settings (auto-accept, pickup, fee,
// timezone) and the city defaults for the address (FR-029, FR-033, FR-034).

import type { Tx } from "@mt/db";

export interface OrderSettings {
  readonly autoAccept: boolean;
  readonly allowPickup: boolean;
  readonly deliveryFeeCents: number;
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
      allow_pickup: boolean | null;
      delivery_fee_cents: number | null;
      timezone: string | null;
      cidade: string | null;
      uf: string | null;
      codigo_municipio: string | null;
    }[]
  >`
    select s.auto_accept, s.allow_pickup, s.delivery_fee_cents, s.timezone, r.cidade, r.uf, r.codigo_municipio
    from public.restaurants r
    left join public.restaurant_settings s on s.restaurant_id = r.id
    where r.id = ${restaurantId}
  `;
  return {
    autoAccept: row?.auto_accept ?? false,
    allowPickup: row?.allow_pickup ?? true,
    deliveryFeeCents: row?.delivery_fee_cents ?? 0,
    timezone: row?.timezone ?? DEFAULT_TIMEZONE,
    cidade: row?.cidade ?? null,
    uf: row?.uf ?? null,
    codigoMunicipio: row?.codigo_municipio ?? null,
  };
}
