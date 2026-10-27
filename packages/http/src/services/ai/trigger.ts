// enqueueAiTurn (FR-181, FR-189, FR-196): runs in the ingest transaction after runInboundAutomation.
// aiWillAnswer (FR-214) runs inside runInboundAutomation with the same decision.

import { AI_TURN_DELAY_SECONDS, type AiPauseReason, decideEnqueue, type EnqueueDecision } from "@mt/core";
import { QUEUES, sendJob, type Tx } from "@mt/db";
import type { AiTurnJob } from "@mt/schemas";

import type { ServiceDeps } from "../../deps";
import { isRestaurantOpen } from "./menu";
import { pauseConversation } from "./messages";
import { loadAiQuota } from "./quota";
import { loadAiSettings } from "./settings";

async function decide(
  tx: Tx,
  deps: ServiceDeps,
  restaurantId: string,
  conversationId: string,
  closedSent: boolean,
): Promise<EnqueueDecision> {
  const settings = await loadAiSettings(tx, restaurantId);
  if (!settings.enabled) return { kind: "skip" };
  const now = deps.clock.now();
  const [conv] = await tx<
    { ai_mode: "auto" | "paused"; ai_pause_reason: AiPauseReason | null; ai_paused_at: Date | null }[]
  >`
    select ai_mode, ai_pause_reason, ai_paused_at from public.conversations
    where id = ${conversationId} and restaurant_id = ${restaurantId}
  `;
  if (conv === undefined) return { kind: "skip" };
  return decideEnqueue({
    enabled: true,
    aiMode: conv.ai_mode,
    pauseReason: conv.ai_pause_reason,
    pausedAt: conv.ai_paused_at,
    autoResumeMinutes: settings.autoResumeMinutes,
    open: await isRestaurantOpen(tx, restaurantId, now),
    closedSent,
    quota: (await loadAiQuota(tx, restaurantId, now, settings)).state,
    now,
  });
}

/** FR-214: true when enqueueAiTurn will queue a turn for this message, so the AI writes the greeting. */
export async function aiWillAnswer(
  tx: Tx,
  deps: ServiceDeps,
  restaurantId: string,
  conversationId: string,
): Promise<boolean> {
  return (await decide(tx, deps, restaurantId, conversationId, false)).kind === "enqueue";
}

export async function enqueueAiTurn(
  tx: Tx,
  deps: ServiceDeps,
  restaurantId: string,
  input: { readonly conversationId: string; readonly triggerMessageId: string; readonly closedSent: boolean },
): Promise<"enqueued" | "skipped" | "paused"> {
  const now = deps.clock.now();
  const decision = await decide(tx, deps, restaurantId, input.conversationId, input.closedSent);
  if (decision.kind === "skip") return "skipped";
  if (decision.kind === "pause") {
    await pauseConversation(tx, restaurantId, input.conversationId, decision.reason, null, now);
    return "paused";
  }
  if (decision.resume) {
    await tx`
      update public.conversations set ai_mode = 'auto', ai_paused_at = null, ai_pause_reason = null, ai_pause_note = null
      where id = ${input.conversationId} and restaurant_id = ${restaurantId}
    `;
  }
  const job: AiTurnJob = {
    v: 1,
    restaurantId,
    conversationId: input.conversationId,
    triggerMessageId: input.triggerMessageId,
    enqueuedAt: now.toISOString(),
  };
  await sendJob(tx, QUEUES.aiTurns, job, AI_TURN_DELAY_SECONDS);
  return "enqueued";
}
