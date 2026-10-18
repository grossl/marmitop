// The counted month for usage (FR-154, FR-196): the restaurant's local calendar month.

import type { Tx } from "@mt/db";
import { DEFAULT_TIMEZONE } from "@mt/schemas";

export async function monthStartFor(tx: Tx, restaurantId: string, now: Date): Promise<Date> {
  const [r] = await tx<{ start: Date }[]>`
    select (date_trunc('month', ${now}::timestamptz at time zone tz) at time zone tz) as start
    from (select coalesce(s.timezone, ${DEFAULT_TIMEZONE}) as tz
          from public.restaurants r left join public.restaurant_settings s on s.restaurant_id = r.id
          where r.id = ${restaurantId}) t
  `;
  return r?.start ?? now;
}
