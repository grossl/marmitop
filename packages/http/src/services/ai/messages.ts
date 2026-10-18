// Assistant outbound messages and conversation pauses (FR-190, FR-192).

import type { AiPauseReason } from "@mt/core";
import { QUEUES, sendJob, type Tx } from "@mt/db";
import type { OutboundMessageJob } from "@mt/schemas";

import { previewOf } from "../messaging/helpers";

/** Stores an assistant reply and enqueues its send in the caller's transaction (outbox, ADR-007). */
export async function storeAiMessage(
  tx: Tx,
  restaurantId: string,
  input: { readonly conversationId: string; readonly body: string; readonly aiRunId: string; readonly at: Date },
): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into public.messages (restaurant_id, conversation_id, direction, body, status, ai_run_id, created_at)
    values (${restaurantId}, ${input.conversationId}, 'out', ${input.body}, 'pending', ${input.aiRunId}, ${input.at})
    returning id
  `;
  if (row === undefined) throw new Error("AI message insert returned no row");
  await tx`
    update public.conversations set
      last_message_at = greatest(coalesce(last_message_at, ${input.at}::timestamptz), ${input.at}::timestamptz),
      last_message_preview = ${previewOf(input.body)}
    where id = ${input.conversationId} and restaurant_id = ${restaurantId}
  `;
  const job: OutboundMessageJob = { v: 1, restaurantId, messageId: row.id };
  await sendJob(tx, QUEUES.outboundMessages, job);
  return row.id;
}

export async function pauseConversation(
  tx: Tx,
  restaurantId: string,
  conversationId: string,
  reason: AiPauseReason,
  note: string | null,
  now: Date,
): Promise<void> {
  await tx`
    update public.conversations set ai_mode = 'paused', ai_paused_at = ${now},
      ai_pause_reason = ${reason}, ai_pause_note = ${note}
    where id = ${conversationId} and restaurant_id = ${restaurantId}
  `;
}
