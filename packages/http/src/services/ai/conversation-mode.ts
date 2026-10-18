// Pausar / Retomar in the chat header (FR-189).

import { AppError } from "@mt/core";
import { setConversationAiModeSchema } from "@mt/schemas";

import { defineService } from "../../service";

export const setConversationAiMode = defineService({
  name: "ai.setConversationMode",
  minRole: "attendant",
  input: setConversationAiModeSchema,
  run: async ({ tx, ctx, deps, input }): Promise<{ aiMode: "auto" | "paused" }> => {
    const rows =
      input.mode === "auto"
        ? await tx<{ id: string }[]>`
            update public.conversations set ai_mode = 'auto', ai_paused_at = null, ai_pause_reason = null, ai_pause_note = null
            where id = ${input.conversationId} and restaurant_id = ${ctx.restaurantId} returning id`
        : await tx<{ id: string }[]>`
            update public.conversations set ai_mode = 'paused', ai_paused_at = ${deps.clock.now()},
              ai_pause_reason = 'manual', ai_pause_note = null
            where id = ${input.conversationId} and restaurant_id = ${ctx.restaurantId} returning id`;
    if (rows.length === 0) throw new AppError("not_found", "Conversation not found.");
    return { aiMode: input.mode };
  },
});
