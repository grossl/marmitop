// packages/http/src/services/admin/plan.ts
//
// Plan tab (FR-092, FR-093, FR-150..FR-156). Plan and invoices come through the
// BillingProvider port (NullBillingProvider in v1, ADR-008). Usage is the
// current local month of `usage_events`. Limits are shown, never enforced.

import { DEFAULT_TIMEZONE } from "@mt/schemas";
import { type BillingInvoice, NullBillingProvider, type Plan } from "@mt/core";
import { z } from "zod";

import { defineService } from "../../service";

export interface UsageLine {
  readonly used: number;
  readonly included: number;
}

export interface PlanAndUsage {
  readonly plan: Plan | null;
  readonly usage: {
    readonly orders: UsageLine;
    readonly messages: UsageLine;
    readonly invoices: UsageLine;
  };
  /** Start of the counted month (instant), for display. */
  readonly periodStart: string;
  readonly invoiceHistory: readonly BillingInvoice[];
}

export const getPlanAndUsage = defineService({
  name: "settings.getPlanAndUsage",
  minRole: "admin",
  input: z.undefined(),
  run: async ({ tx, ctx, deps }): Promise<PlanAndUsage> => {
    const provider = new NullBillingProvider({
      loadPlan: async (restaurantId) => {
        const [row] = await tx<
          {
            code: string;
            name: string;
            included_orders_month: number;
            included_messages_month: number;
            included_invoices_month: number;
            price_display: string;
          }[]
        >`
          select p.code, p.name, p.included_orders_month, p.included_messages_month,
                 p.included_invoices_month, p.price_display
          from public.plans p join public.restaurants r on r.plan_code = p.code
          where r.id = ${restaurantId}
        `;
        return row === undefined
          ? null
          : {
              code: row.code,
              name: row.name,
              includedOrdersMonth: row.included_orders_month,
              includedMessagesMonth: row.included_messages_month,
              includedInvoicesMonth: row.included_invoices_month,
              priceDisplay: row.price_display,
            };
      },
    });
    const plan = await provider.getPlan(ctx.restaurantId);
    const invoiceHistory = await provider.listInvoices(ctx.restaurantId);

    const [settings] = await tx<{ timezone: string }[]>`
      select timezone from public.restaurant_settings where restaurant_id = ${ctx.restaurantId}
    `;
    const timezone = settings?.timezone ?? DEFAULT_TIMEZONE;
    const now = deps.clock.now().toISOString();
    const [bounds] = await tx<{ start: Date; next: Date }[]>`
      select (date_trunc('month', ${now}::timestamptz at time zone ${timezone}) at time zone ${timezone}) as start,
             ((date_trunc('month', ${now}::timestamptz at time zone ${timezone}) + interval '1 month') at time zone ${timezone}) as next
    `;
    const counts = await tx<{ kind: string; n: number }[]>`
      select kind, count(*)::int as n from public.usage_events
      where restaurant_id = ${ctx.restaurantId} and occurred_at >= ${bounds?.start ?? new Date(0)}
        and occurred_at < ${bounds?.next ?? new Date(8.64e15)}
      group by kind
    `;
    const used = (kind: string) => counts.find((c) => c.kind === kind)?.n ?? 0;
    return {
      plan,
      usage: {
        orders: { used: used("order.created"), included: plan?.includedOrdersMonth ?? 0 },
        messages: { used: used("message.sent"), included: plan?.includedMessagesMonth ?? 0 },
        invoices: { used: used("invoice.issued"), included: plan?.includedInvoicesMonth ?? 0 },
      },
      periodStart: (bounds?.start ?? new Date(0)).toISOString(),
      invoiceHistory,
    };
  },
});
