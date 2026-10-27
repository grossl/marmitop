// packages/http/src/services/admin/settings.ts
//
// Settings (FR-080..FR-084, FR-096, 06.api-spec.md Appendix A). Admin only.
// `saveProfile` lives in ../restaurant-profile.ts and is reused here.

import { AppError } from "@mt/core";
import type { Tx } from "@mt/db";
import {
  AUTOMATIC_MESSAGE_KINDS,
  DEFAULT_TIMEZONE,
  saveAutomaticMessageSchema,
  saveBusinessHoursSchema,
  saveOrderPreferencesSchema,
} from "@mt/schemas";
import { z } from "zod";

import { defineService } from "../../service";
import { type RestaurantProfile } from "../restaurant-profile";
import { type IntegrationsState, loadIntegrationsState } from "./integrations";

export interface OrderPreferences {
  readonly autoAccept: boolean;
  readonly pickupEnabled: boolean;
  readonly showDeliveryEstimate: boolean;
  readonly deliveryFeeCents: number;
  readonly deliveryEstimateMinutes: number;
  readonly timezone: string;
}

export interface BusinessHoursDay {
  readonly weekday: number;
  readonly enabled: boolean;
  /** `HH:MM`. */
  readonly opensAt: string;
  readonly closesAt: string;
}

export interface AutomaticMessageSetting {
  readonly kind: (typeof AUTOMATIC_MESSAGE_KINDS)[number];
  readonly enabled: boolean;
  readonly body: string;
  readonly templateName: string | null;
  readonly templateLanguage: string | null;
}

export interface SettingsView {
  readonly profile: RestaurantProfile;
  readonly preferences: OrderPreferences;
  /** Seven entries, weekday 0 (Sunday) to 6. Missing days come back disabled. */
  readonly hours: BusinessHoursDay[];
  /** Always the nine kinds of AUTOMATIC_MESSAGE_KINDS, in order. A missing row comes back disabled with an empty body. */
  readonly automaticMessages: AutomaticMessageSetting[];
  readonly integrations: IntegrationsState;
}

const DEFAULT_PREFERENCES: OrderPreferences = {
  autoAccept: false,
  pickupEnabled: true,
  showDeliveryEstimate: true,
  deliveryFeeCents: 0,
  deliveryEstimateMinutes: 45,
  timezone: DEFAULT_TIMEZONE,
};

const hhmm = (t: string) => t.slice(0, 5);

async function readPreferences(tx: Tx, restaurantId: string): Promise<OrderPreferences> {
  const [row] = await tx<
    {
      auto_accept: boolean;
      allow_pickup: boolean;
      show_delivery_estimate: boolean;
      delivery_estimate_minutes: number;
      delivery_fee_cents: number;
      timezone: string;
    }[]
  >`
    select auto_accept, allow_pickup, show_delivery_estimate, delivery_estimate_minutes, delivery_fee_cents, timezone
    from public.restaurant_settings where restaurant_id = ${restaurantId}
  `;
  return row === undefined
    ? DEFAULT_PREFERENCES
    : {
        autoAccept: row.auto_accept,
        pickupEnabled: row.allow_pickup,
        showDeliveryEstimate: row.show_delivery_estimate,
        deliveryFeeCents: row.delivery_fee_cents,
        deliveryEstimateMinutes: row.delivery_estimate_minutes,
        timezone: row.timezone,
      };
}

export const getSettings = defineService({
  name: "settings.get",
  minRole: "admin",
  input: z.undefined(),
  run: async ({ tx, ctx }): Promise<SettingsView> => {
    const [r] = await tx<
      {
        id: string;
        public_id: string;
        name: string;
        phone: string | null;
        email: string | null;
        address: string | null;
        cidade: string | null;
        uf: string | null;
        codigo_municipio: string | null;
        plan_code: string;
      }[]
    >`
      select id, public_id, name, phone, email, address, cidade, uf, codigo_municipio, plan_code
      from public.restaurants where id = ${ctx.restaurantId}
    `;
    if (r === undefined) throw new AppError("not_found", "Restaurant not found.");
    const profile: RestaurantProfile = {
      id: r.id,
      publicId: r.public_id,
      name: r.name,
      phone: r.phone,
      email: r.email,
      address: r.address,
      cidade: r.cidade,
      uf: r.uf,
      codigoMunicipio: r.codigo_municipio,
      planCode: r.plan_code,
    };
    const preferences = await readPreferences(tx, ctx.restaurantId);

    const hourRows = await tx<{ weekday: number; enabled: boolean; opens_at: string; closes_at: string }[]>`
      select weekday, enabled, opens_at::text, closes_at::text from public.business_hours
      where restaurant_id = ${ctx.restaurantId}
    `;
    const hours: BusinessHoursDay[] = Array.from({ length: 7 }, (_, weekday) => {
      const row = hourRows.find((h) => h.weekday === weekday);
      return row
        ? { weekday, enabled: row.enabled, opensAt: hhmm(row.opens_at), closesAt: hhmm(row.closes_at) }
        : { weekday, enabled: false, opensAt: "08:00", closesAt: "18:00" };
    });

    const msgRows = await tx<
      { kind: AutomaticMessageSetting["kind"]; enabled: boolean; body: string; template_name: string | null; template_language: string | null }[]
    >`
      select kind, enabled, body, template_name, template_language from public.automatic_messages
      where restaurant_id = ${ctx.restaurantId}
    `;
    const automaticMessages = AUTOMATIC_MESSAGE_KINDS.map((kind): AutomaticMessageSetting => {
      const row = msgRows.find((m) => m.kind === kind);
      return row
        ? { kind, enabled: row.enabled, body: row.body, templateName: row.template_name, templateLanguage: row.template_language }
        : { kind, enabled: false, body: "", templateName: null, templateLanguage: null };
    });

    return { profile, preferences, hours, automaticMessages, integrations: await loadIntegrationsState(tx, ctx) };
  },
});

export const saveOrderPreferences = defineService({
  name: "settings.saveOrderPreferences",
  minRole: "admin",
  input: saveOrderPreferencesSchema,
  run: async ({ tx, ctx, input }): Promise<OrderPreferences> => {
    const [row] = await tx<{ restaurant_id: string }[]>`
      insert into public.restaurant_settings
        (restaurant_id, auto_accept, allow_pickup, show_delivery_estimate, delivery_fee_cents,
         delivery_estimate_minutes, timezone)
      values (${ctx.restaurantId}, ${input.autoAccept}, ${input.pickupEnabled}, ${input.showDeliveryEstimate},
              ${input.deliveryFeeCents}, ${input.deliveryEstimateMinutes}, ${input.timezone})
      on conflict (restaurant_id) do update set
        auto_accept = excluded.auto_accept,
        allow_pickup = excluded.allow_pickup,
        show_delivery_estimate = excluded.show_delivery_estimate,
        delivery_fee_cents = excluded.delivery_fee_cents,
        delivery_estimate_minutes = excluded.delivery_estimate_minutes,
        timezone = excluded.timezone
      returning restaurant_id
    `;
    if (row === undefined) throw new AppError("forbidden", "Your role cannot perform this action.");
    return {
      autoAccept: input.autoAccept,
      pickupEnabled: input.pickupEnabled,
      showDeliveryEstimate: input.showDeliveryEstimate,
      deliveryFeeCents: input.deliveryFeeCents,
      deliveryEstimateMinutes: input.deliveryEstimateMinutes,
      timezone: input.timezone,
    };
  },
});

export const saveBusinessHours = defineService({
  name: "settings.saveBusinessHours",
  minRole: "admin",
  input: saveBusinessHoursSchema,
  run: async ({ tx, ctx, input }): Promise<{ days: BusinessHoursDay[] }> => {
    for (const d of input.days) {
      const rows = await tx<{ weekday: number }[]>`
        insert into public.business_hours (restaurant_id, weekday, enabled, opens_at, closes_at)
        values (${ctx.restaurantId}, ${d.weekday}, ${d.enabled}, ${d.opensAt}, ${d.closesAt})
        on conflict (restaurant_id, weekday) do update set
          enabled = excluded.enabled, opens_at = excluded.opens_at, closes_at = excluded.closes_at
        returning weekday
      `;
      if (rows.length === 0) throw new AppError("forbidden", "Your role cannot perform this action.");
    }
    return { days: [...input.days].sort((a, b) => a.weekday - b.weekday) };
  },
});

export const saveAutomaticMessage = defineService({
  name: "settings.saveAutomaticMessage",
  minRole: "admin",
  input: saveAutomaticMessageSchema,
  run: async ({ tx, ctx, input }): Promise<AutomaticMessageSetting> => {
    const [row] = await tx<{ kind: string }[]>`
      insert into public.automatic_messages (restaurant_id, kind, enabled, body, template_name, template_language)
      values (${ctx.restaurantId}, ${input.kind}, ${input.enabled}, ${input.body}, ${input.templateName},
              ${input.templateLanguage})
      on conflict (restaurant_id, kind) do update set
        enabled = excluded.enabled, body = excluded.body,
        template_name = excluded.template_name, template_language = excluded.template_language
      returning kind
    `;
    if (row === undefined) throw new AppError("forbidden", "Your role cannot perform this action.");
    return {
      kind: input.kind,
      enabled: input.enabled,
      body: input.body,
      templateName: input.templateName,
      templateLanguage: input.templateLanguage,
    };
  },
});
