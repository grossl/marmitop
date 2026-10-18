// runAiTurn (12.ai-order-assistant.md "Flow"): claim → tool loop → finish. No transaction stays
// open during a model call. The conversation claim (ai_turn_claimed_at) serializes turns.

import {
  AI_HISTORY_WINDOW,
  AI_MAX_MODEL_CALLS,
  AI_RELOCK_DELAY_SECONDS,
  AI_REPLY_MAX_CHARS,
  AI_TOOL_SPECS,
  type AiPauseReason,
  type AssistantMessage,
  type AssistantModel,
  AssistantModelError,
  type AssistantRequest,
  type AssistantToolResultBlock,
  decideTurnStart,
  formatBRL,
  historyToMessages,
  weekdayInTimezone,
} from "@mt/core";
import { type AiRunRow, QUEUES, sendJob, type Tx, withRestaurantContext } from "@mt/db";
import type { AiTurnJob } from "@mt/schemas";

import { toDbContext } from "../../context";
import type { ServiceDeps } from "../../deps";
import { recordUsage } from "../billing/usage";
import { loadOrderSettings } from "../orders/order-settings";
import { loadAutomationSettings } from "../whatsapp/automatic";
import { systemCtx } from "../whatsapp/connection";
import { loadCart } from "./cart-store";
import { loadTodayMenu } from "./menu";
import { pauseConversation, storeAiMessage } from "./messages";
import { AI_INSTRUCTIONS, renderRestaurantBlock, renderTurnContext } from "./prompt";
import { loadAiQuota } from "./quota";
import { loadAiSettings } from "./settings";
import { type AiToolScope, runAiTool } from "./tools";

export type AiTurnOutcome =
  | { readonly kind: "done"; readonly status: AiRunRow["status"]; readonly runId: string }
  | { readonly kind: "retry"; readonly errorCode: string; readonly runId: string };

interface Started {
  readonly runId: string;
  readonly scope: AiToolScope;
  readonly request: Omit<AssistantRequest, "messages"> & { readonly messages: AssistantMessage[] };
}

const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

function tx<T>(deps: ServiceDeps, restaurantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withRestaurantContext(deps.db, toDbContext(systemCtx(restaurantId)), fn, deps.contextOptions);
}

async function insertRun(
  t: Tx,
  job: AiTurnJob,
  status: AiRunRow["status"],
  billedAs: "included" | "overage" | null,
  now: Date,
): Promise<string> {
  const [r] = await t<{ id: string }[]>`
    insert into public.ai_runs (restaurant_id, conversation_id, trigger_message_id, status, billed_as,
      finished_at)
    values (${job.restaurantId}, ${job.conversationId}, ${job.triggerMessageId}, ${status}, ${billedAs},
      ${status === "running" ? null : now})
    returning id
  `;
  if (r === undefined) throw new Error("ai_runs insert returned no row");
  return r.id;
}

/** Step 1: guards, claim, usage, and the request — one committed transaction. */
async function start(deps: ServiceDeps, job: AiTurnJob): Promise<Started | AiTurnOutcome> {
  return tx(deps, job.restaurantId, async (t) => {
    const now = deps.clock.now();
    const [conv] = await t<
      {
        customer_id: string;
        ai_mode: "auto" | "paused";
        ai_turn_claimed_at: Date | null;
        name: string;
        phone: string;
        logradouro: string | null;
        numero: string | null;
        bairro: string | null;
      }[]
    >`
      select c.customer_id, c.ai_mode, c.ai_turn_claimed_at, cu.name, cu.phone, cu.logradouro, cu.numero, cu.bairro
      from public.conversations c
      join public.customers cu on cu.restaurant_id = c.restaurant_id and cu.id = c.customer_id
      where c.id = ${job.conversationId} and c.restaurant_id = ${job.restaurantId}
      for update of c
    `;
    if (conv === undefined) return { kind: "done", status: "stopped", runId: "" } as const;
    // `out_after` counts only a reply: an attendant message (sent_by) or an AI message (ai_run_id).
    // An automatic message (the welcome stored with the inbound row) is not an answer.
    const [facts] = await t<{ latest_in: string | null; out_after: number }[]>`
      select
        (select id from public.messages where restaurant_id = ${job.restaurantId} and conversation_id = ${job.conversationId}
           and direction = 'in' order by created_at desc, id desc limit 1) as latest_in,
        (select count(*)::int from public.messages m
           join public.messages trig on trig.id = ${job.triggerMessageId} and trig.restaurant_id = m.restaurant_id
           where m.restaurant_id = ${job.restaurantId} and m.conversation_id = ${job.conversationId}
             and m.direction = 'out' and m.created_at > trig.created_at
             and m.automatic_kind is null and (m.sent_by is not null or m.ai_run_id is not null)) as out_after
    `;
    const settings = await loadAiSettings(t, job.restaurantId);
    const quota = await loadAiQuota(t, job.restaurantId, now, settings);
    const guard = decideTurnStart({
      triggerIsLatestInbound: facts?.latest_in === job.triggerMessageId,
      aiMode: settings.enabled ? conv.ai_mode : "paused",
      outboundAfterTrigger: (facts?.out_after ?? 0) > 0,
      enqueuedAt: new Date(job.enqueuedAt),
      now,
      claimedAt: conv.ai_turn_claimed_at,
      quota: quota.state,
    });

    if (guard.kind === "stop") {
      const runId = await insertRun(t, job, guard.status, null, now);
      if (guard.pause !== null)
        await pauseConversation(t, job.restaurantId, job.conversationId, guard.pause, null, now);
      if (guard.status === "locked") await sendJob(t, QUEUES.aiTurns, job, AI_RELOCK_DELAY_SECONDS);
      return { kind: "done", status: guard.status, runId } as const;
    }

    const rows = await t<
      {
        direction: "in" | "out";
        body: string;
        automatic_kind: string | null;
        sent_by: string | null;
        ai_run_id: string | null;
      }[]
    >`
      select * from (
        select direction, body, automatic_kind, sent_by, ai_run_id, created_at, id from public.messages
        where restaurant_id = ${job.restaurantId} and conversation_id = ${job.conversationId}
        order by created_at desc, id desc limit ${AI_HISTORY_WINDOW}
      ) recent order by created_at asc, id asc
    `;
    const messages = historyToMessages(
      rows.map((r) => ({
        direction: r.direction,
        body: r.body,
        automaticKind: r.automatic_kind,
        sentByUser: r.sent_by !== null,
        aiRunId: r.ai_run_id,
      })),
    );
    // The model never gets zero messages. No claim and no usage: the turn ends before any model call.
    if (messages.length === 0) {
      const runId = await insertRun(t, job, "silent", null, now);
      return { kind: "done", status: "silent", runId } as const;
    }

    const runId = await insertRun(t, job, "running", guard.billedAs, now);
    await t`update public.conversations set ai_turn_claimed_at = ${now} where id = ${job.conversationId} and restaurant_id = ${job.restaurantId}`;
    await recordUsage(t, job.restaurantId, "ai.reply", runId, now);

    const { menu, categories } = await loadTodayMenu(t, deps, job.restaurantId);
    const order = await loadOrderSettings(t, job.restaurantId);
    const auto = await loadAutomationSettings(t, job.restaurantId);
    const cart = await loadCart(t, job.restaurantId, job.conversationId);
    const local = new Intl.DateTimeFormat("en-CA", {
      timeZone: auto.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const weekday = weekdayInTimezone(now, auto.timezone);
    const today = auto.hours.find((h) => h.weekday === weekday);

    return {
      runId,
      scope: {
        restaurantId: job.restaurantId,
        conversationId: job.conversationId,
        customerId: conv.customer_id,
        runId,
      },
      request: {
        instructions: AI_INSTRUCTIONS,
        restaurantBlock: renderRestaurantBlock({
          name: auto.restaurantName,
          date: local,
          weekdayName: WEEKDAYS[weekday] ?? "",
          hoursToday: today?.enabled ? `${today.opensAt.slice(0, 5)}–${today.closesAt.slice(0, 5)}` : "fechado",
          allowPickup: order.allowPickup,
          deliveryFee: formatBRL(order.deliveryFeeCents),
          deliveryEstimateMinutes: order.showDeliveryEstimate ? order.deliveryEstimateMinutes : null,
          personaName: settings.personaName,
          extraInstructions: settings.extraInstructions,
          menu: menu.map((m) => ({
            menuItemId: m.id,
            name: m.name,
            category: categories.get(m.id) ?? "",
            kind: m.kind,
            price: m.sizes.length === 0 ? formatBRL(m.priceCents) : null,
            sizes: m.sizes.map((s) => ({ sizeId: s.id, name: s.name, price: formatBRL(s.priceCents) })),
          })),
        }),
        tools: AI_TOOL_SPECS,
        messages,
        turnContext: renderTurnContext({
          cart: cart.id === null || cart.status !== "open" ? null : cart.state,
          customerName: conv.name === conv.phone ? null : conv.name,
          savedAddress: conv.logradouro ? [conv.logradouro, conv.numero, conv.bairro].filter(Boolean).join(", ") : null,
        }),
      },
    };
  });
}

interface Tally {
  modelCalls: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  model: string | null;
  tools: { name: string; ok: boolean; error_code: string | null }[];
  stopReason: string | null;
}

async function finish(
  deps: ServiceDeps,
  job: AiTurnJob,
  runId: string,
  tally: Tally,
  result: { status: AiRunRow["status"]; reply: string | null; pause: AiPauseReason | null; errorCode: string | null },
): Promise<AiRunRow["status"]> {
  return tx(deps, job.restaurantId, async (t) => {
    const now = deps.clock.now();
    let status = result.status;
    const [conv] = await t<{ ai_mode: string; ai_pause_reason: AiPauseReason | null }[]>`
      select ai_mode, ai_pause_reason from public.conversations
      where id = ${job.conversationId} and restaurant_id = ${job.restaurantId} for update`;
    // Drop the reply only when a person paused the conversation during the loop (12 "Reply").
    // A pause from this turn's own handoff_to_human keeps the closing reply.
    const pausedByPerson =
      conv?.ai_mode === "paused" && (conv.ai_pause_reason === "attendant" || conv.ai_pause_reason === "manual");
    if (result.reply !== null) {
      if (conv !== undefined && !pausedByPerson)
        await storeAiMessage(t, job.restaurantId, {
          conversationId: job.conversationId,
          body: result.reply,
          aiRunId: runId,
          at: now,
        });
      else if (status === "replied") status = "silent";
    }
    // Never overwrite an existing pause (an attendant's, or this turn's handoff with its note).
    if (result.pause !== null && conv?.ai_mode === "auto")
      await pauseConversation(t, job.restaurantId, job.conversationId, result.pause, null, now);
    await t`update public.conversations set ai_turn_claimed_at = null where id = ${job.conversationId} and restaurant_id = ${job.restaurantId}`;
    await t`
      update public.ai_runs set status = ${status}, model = ${tally.model}, model_calls = ${tally.modelCalls},
        input_tokens = ${tally.input}, cache_read_tokens = ${tally.cacheRead}, cache_write_tokens = ${tally.cacheWrite},
        output_tokens = ${tally.output}, tool_calls = ${JSON.stringify(tally.tools)}::jsonb,
        stop_reason = ${tally.stopReason}, error_code = ${result.errorCode}, finished_at = ${now}
      where id = ${runId} and restaurant_id = ${job.restaurantId}
    `;
    return status;
  });
}

export async function runAiTurn(deps: ServiceDeps, model: AssistantModel, job: AiTurnJob): Promise<AiTurnOutcome> {
  const started = await start(deps, job);
  if ("kind" in started) return started;
  const { runId, scope, request } = started;
  const tally: Tally = {
    modelCalls: 0,
    input: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    model: null,
    tools: [],
    stopReason: null,
  };

  try {
    while (tally.modelCalls < AI_MAX_MODEL_CALLS) {
      const res = await model.respond(request);
      tally.modelCalls += 1;
      tally.model = res.model;
      tally.input += res.usage.inputTokens;
      tally.cacheRead += res.usage.cacheReadTokens;
      tally.cacheWrite += res.usage.cacheWriteTokens;
      tally.output += res.usage.outputTokens;
      tally.stopReason = res.stopReason;

      if (res.stopReason === "end_turn") {
        const text = res.content
          .flatMap((b) => (b.type === "text" ? [b.text] : []))
          .join("\n")
          .trim()
          .slice(0, AI_REPLY_MAX_CHARS);
        const status = await finish(deps, job, runId, tally, {
          status: text ? "replied" : "silent",
          reply: text || null,
          pause: null,
          errorCode: null,
        });
        return { kind: "done", status, runId };
      }
      if (res.stopReason !== "tool_use") break;

      request.messages.push({ role: "assistant", content: res.content, raw: res.raw });
      const results: AssistantToolResultBlock[] = [];
      for (const block of res.content) {
        if (block.type !== "tool_use") continue;
        const r = await tx(deps, job.restaurantId, (t) => runAiTool(t, deps, scope, block.name, block.input));
        tally.tools.push({ name: block.name, ok: r.ok, error_code: r.errorCode });
        results.push({ type: "tool_result", toolUseId: block.id, content: r.content, isError: !r.ok });
      }
      request.messages.push({ role: "user", content: results });
    }
    const status = await finish(deps, job, runId, tally, {
      status: "stopped",
      reply: null,
      pause: "model",
      errorCode: null,
    });
    return { kind: "done", status, runId };
  } catch (error) {
    const code = error instanceof AssistantModelError ? error.code : "internal_error";
    const retryable = error instanceof AssistantModelError && error.retryable;
    await finish(deps, job, runId, tally, {
      status: "failed",
      reply: null,
      pause: retryable ? null : "model",
      errorCode: code,
    });
    if (retryable) return { kind: "retry", errorCode: code, runId };
    return { kind: "done", status: "failed", runId };
  }
}
