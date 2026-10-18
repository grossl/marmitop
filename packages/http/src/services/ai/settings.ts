// AI assistant settings (FR-180). One row per restaurant; no row means the defaults (off).

import type { Tx } from "@mt/db";
import { saveAiSettingsSchema } from "@mt/schemas";
import { z } from "zod";

import { defineService } from "../../service";
import { type AiQuota, loadAiQuota } from "./quota";

export interface AiSettings {
  readonly enabled: boolean;
  readonly personaName: string;
  readonly extraInstructions: string | null;
  readonly autoResumeMinutes: number;
  readonly allowOverage: boolean;
  readonly monthlyHardCap: number;
}

export const AI_SETTINGS_DEFAULTS: AiSettings = {
  enabled: false,
  personaName: "Atendente",
  extraInstructions: null,
  autoResumeMinutes: 360,
  allowOverage: false,
  monthlyHardCap: 20000,
};

export async function loadAiSettings(tx: Tx, restaurantId: string): Promise<AiSettings> {
  const [r] = await tx<
    {
      enabled: boolean;
      persona_name: string;
      extra_instructions: string | null;
      auto_resume_minutes: number;
      allow_overage: boolean;
      monthly_hard_cap: number;
    }[]
  >`
    select enabled, persona_name, extra_instructions, auto_resume_minutes, allow_overage, monthly_hard_cap
    from public.ai_settings where restaurant_id = ${restaurantId}
  `;
  if (r === undefined) return AI_SETTINGS_DEFAULTS;
  return {
    enabled: r.enabled,
    personaName: r.persona_name,
    extraInstructions: r.extra_instructions,
    autoResumeMinutes: r.auto_resume_minutes,
    allowOverage: r.allow_overage,
    monthlyHardCap: r.monthly_hard_cap,
  };
}

export const getAiSettings = defineService({
  name: "ai.getSettings",
  minRole: "admin",
  input: z.undefined(),
  run: async ({ tx, ctx, deps }): Promise<AiSettings & { readonly quota: AiQuota }> => {
    const settings = await loadAiSettings(tx, ctx.restaurantId);
    return { ...settings, quota: await loadAiQuota(tx, ctx.restaurantId, deps.clock.now(), settings) };
  },
});

export const saveAiSettings = defineService({
  name: "ai.saveSettings",
  minRole: "admin",
  input: saveAiSettingsSchema,
  run: async ({ tx, ctx, input }): Promise<AiSettings> => {
    await tx`
      insert into public.ai_settings
        (restaurant_id, enabled, persona_name, extra_instructions, auto_resume_minutes, allow_overage, monthly_hard_cap)
      values (${ctx.restaurantId}, ${input.enabled}, ${input.personaName}, ${input.extraInstructions},
              ${input.autoResumeMinutes}, ${input.allowOverage}, ${input.monthlyHardCap})
      on conflict (restaurant_id) do update set
        enabled = excluded.enabled, persona_name = excluded.persona_name,
        extra_instructions = excluded.extra_instructions, auto_resume_minutes = excluded.auto_resume_minutes,
        allow_overage = excluded.allow_overage, monthly_hard_cap = excluded.monthly_hard_cap
    `;
    return input;
  },
});
