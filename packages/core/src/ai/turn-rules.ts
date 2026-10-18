// Turn decisions for the AI assistant (12.ai-order-assistant.md "Trigger", "Quota check",
// "Guards in the worker", "place_order guard"). Pure: callers load the facts.

export const AI_TURN_DELAY_SECONDS = 8;
export const AI_TURN_STALE_MS = 120_000;
/**
 * Wall-clock budget for one turn (every model call, retries included). It must stay below
 * AI_TURN_STALE_MS, or a second turn could claim the conversation while this one still runs.
 */
export const AI_TURN_BUDGET_MS = 100_000;
export const AI_MAX_MODEL_CALLS = 6;
export const AI_REPLY_MAX_CHARS = 1000;
export const AI_HISTORY_WINDOW = 20;
export const AI_SUMMARY_TTL_MS = 30 * 60_000;
export const AI_CART_ABANDON_MS = 6 * 3_600_000;
export const AI_RELOCK_DELAY_SECONDS = 5;

export type AiQuotaState = "included" | "overage" | "blocked_quota" | "blocked_cap";

export function aiQuotaState(i: {
  readonly used: number;
  readonly included: number;
  readonly allowOverage: boolean;
  readonly hardCap: number;
}): AiQuotaState {
  if (i.used >= i.hardCap) return "blocked_cap";
  if (i.used < i.included) return "included";
  return i.allowOverage ? "overage" : "blocked_quota";
}

export function overageAmountCents(i: {
  readonly used: number;
  readonly included: number;
  readonly pricePer100Cents: number;
}): { readonly extra: number; readonly amountCents: number } {
  const extra = Math.max(0, i.used - i.included);
  return { extra, amountCents: Math.ceil(extra / 100) * i.pricePer100Cents };
}

export type AiPauseReason =
  | "attendant"
  | "manual"
  | "customer_request"
  | "complaint"
  | "order_change"
  | "status_question"
  | "unsupported_media"
  | "unclear"
  | "other"
  | "model"
  | "stale"
  | "quota"
  | "cap";

/** Pauses that end by themselves after `auto_resume_minutes` (FR-189). */
const AUTO_RESUMABLE: ReadonlySet<AiPauseReason> = new Set(["attendant", "manual"]);

export interface EnqueueDecisionInput {
  readonly enabled: boolean;
  readonly aiMode: "auto" | "paused";
  readonly pauseReason: AiPauseReason | null;
  readonly pausedAt: Date | null;
  readonly autoResumeMinutes: number;
  readonly open: boolean;
  readonly closedSent: boolean;
  readonly quota: AiQuotaState;
  readonly now: Date;
}

export type EnqueueDecision =
  | { readonly kind: "enqueue"; readonly resume: boolean }
  | { readonly kind: "skip" }
  | { readonly kind: "pause"; readonly reason: "quota" | "cap" };

export function decideEnqueue(i: EnqueueDecisionInput): EnqueueDecision {
  if (!i.enabled || !i.open || i.closedSent) return { kind: "skip" };
  let resume = false;
  if (i.aiMode === "paused") {
    const resumable =
      i.pauseReason !== null &&
      AUTO_RESUMABLE.has(i.pauseReason) &&
      i.autoResumeMinutes > 0 &&
      i.pausedAt !== null &&
      i.now.getTime() - i.pausedAt.getTime() >= i.autoResumeMinutes * 60_000;
    if (!resumable) return { kind: "skip" };
    resume = true;
  }
  if (i.quota === "blocked_quota") return { kind: "pause", reason: "quota" };
  if (i.quota === "blocked_cap") return { kind: "pause", reason: "cap" };
  return { kind: "enqueue", resume };
}

export interface TurnGuardInput {
  readonly triggerIsLatestInbound: boolean;
  readonly aiMode: "auto" | "paused";
  readonly outboundAfterTrigger: boolean;
  readonly enqueuedAt: Date;
  readonly now: Date;
  readonly claimedAt: Date | null;
  readonly quota: AiQuotaState;
}

export type TurnGuard =
  | { readonly kind: "run"; readonly billedAs: "included" | "overage" }
  | {
      readonly kind: "stop";
      readonly status: "superseded" | "paused" | "answered" | "stale" | "blocked" | "locked";
      readonly pause: "stale" | "quota" | "cap" | null;
    };

export function decideTurnStart(i: TurnGuardInput): TurnGuard {
  if (!i.triggerIsLatestInbound) return { kind: "stop", status: "superseded", pause: null };
  if (i.aiMode === "paused") return { kind: "stop", status: "paused", pause: null };
  if (i.outboundAfterTrigger) return { kind: "stop", status: "answered", pause: null };
  if (i.now.getTime() - i.enqueuedAt.getTime() > AI_TURN_STALE_MS)
    return { kind: "stop", status: "stale", pause: "stale" };
  if (i.quota === "blocked_quota") return { kind: "stop", status: "blocked", pause: "quota" };
  if (i.quota === "blocked_cap") return { kind: "stop", status: "blocked", pause: "cap" };
  if (i.claimedAt !== null && i.now.getTime() - i.claimedAt.getTime() < AI_TURN_STALE_MS) {
    return { kind: "stop", status: "locked", pause: null };
  }
  return { kind: "run", billedAs: i.quota === "overage" ? "overage" : "included" };
}

export interface PlaceOrderGuardInput {
  readonly status: "open" | "placed" | "abandoned";
  readonly version: number;
  readonly summaryVersion: number | null;
  readonly summarySentAt: Date | null;
  readonly inboundAfterSummary: boolean;
  readonly open: boolean;
  readonly now: Date;
}

export function checkPlaceOrder(
  i: PlaceOrderGuardInput,
): { readonly ok: true } | { readonly ok: false; readonly code: "not_confirmed" | "closed" } {
  if (!i.open) return { ok: false, code: "closed" };
  const fresh = i.summarySentAt !== null && i.now.getTime() - i.summarySentAt.getTime() <= AI_SUMMARY_TTL_MS;
  if (i.status !== "open" || i.summaryVersion !== i.version || !fresh || !i.inboundAfterSummary) {
    return { ok: false, code: "not_confirmed" };
  }
  return { ok: true };
}
