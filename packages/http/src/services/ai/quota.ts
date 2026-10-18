// AI reply quota (FR-196, ADR-025 Decision 4).

import { type AiQuotaState, aiQuotaState, overageAmountCents } from "@mt/core";
import type { Tx } from "@mt/db";

import { monthStartFor } from "../billing/period";
import type { AiSettings } from "./settings";

export interface AiQuota {
  readonly state: AiQuotaState;
  readonly used: number;
  readonly included: number;
  readonly pricePer100Cents: number;
  readonly extra: number;
  readonly amountCents: number;
}

export async function loadAiQuota(tx: Tx, restaurantId: string, now: Date, settings: AiSettings): Promise<AiQuota> {
  const since = await monthStartFor(tx, restaurantId, now);
  const [row] = await tx<{ used: number; included: number | null; price: string | null }[]>`
    select
      (select count(*)::int from public.usage_events
        where restaurant_id = ${restaurantId} and kind = 'ai.reply' and occurred_at >= ${since}) as used,
      p.included_ai_replies_month as included,
      p.ai_overage_price_cents::text as price
    from public.restaurants r left join public.plans p on p.code = r.plan_code
    where r.id = ${restaurantId}
  `;
  const used = row?.used ?? 0;
  const included = row?.included ?? 0;
  const pricePer100Cents = Number(row?.price ?? 0);
  const { extra, amountCents } = overageAmountCents({ used, included, pricePer100Cents });
  return {
    state: aiQuotaState({ used, included, allowOverage: settings.allowOverage, hardCap: settings.monthlyHardCap }),
    used,
    included,
    pricePer100Cents,
    extra: settings.allowOverage ? extra : 0,
    amountCents: settings.allowOverage ? amountCents : 0,
  };
}
