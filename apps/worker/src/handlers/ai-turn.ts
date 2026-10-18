// mt_ai_turns: one assistant turn per inbound burst (12.ai-order-assistant.md "Flow", ADR-025).
// A failed turn has already recorded its ai_runs row. The framework retries a transient model error
// 20 seconds later and a shutdown 5 seconds later. A retry keeps the payload, so `enqueuedAt` stays,
// and runAiTurn turns a job older than 120 seconds into `stale`.

import { AI_TURN_BUDGET_MS, type AssistantModel } from "@mt/core";
import { QUEUES } from "@mt/db";
import { type AiTurnOutcome, type AiTurnSignals, runAiTurn, type ServiceDeps } from "@mt/http";
import { type AiTurnJob, aiTurnJobSchema } from "@mt/schemas";

import type { JobHandler } from "../framework/types";

export interface AiTurnHandlerDeps {
  readonly serviceDeps: ServiceDeps;
  readonly model: AssistantModel;
  /** Injected in tests. */
  readonly runTurn?: (
    deps: ServiceDeps,
    model: AssistantModel,
    job: AiTurnJob,
    signals?: AiTurnSignals,
  ) => Promise<AiTurnOutcome>;
}

/** Fixed retry delays (12 "Errors and limits"), not the ADR-007 backoff. */
const MODEL_RETRY_MS = 20_000;
const SHUTDOWN_RETRY_MS = 5_000;

export function createAiTurnHandler(deps: AiTurnHandlerDeps): JobHandler<AiTurnJob> {
  const runTurn = deps.runTurn ?? runAiTurn;
  return {
    name: "ai.turn",
    queue: QUEUES.aiTurns,
    schema: aiTurnJobSchema,
    subjectType: "ai_turn",
    subjectId: (job) => job.conversationId,
    visibilityTimeoutSeconds: 180,
    async run({ payload, signal }) {
      // The turn ends before its claim goes stale (AI_TURN_BUDGET_MS < AI_TURN_STALE_MS) or on shutdown.
      // The two signals stay separate so runAiTurn can retry a shutdown and fail a budget abort.
      const budget = AbortSignal.timeout(AI_TURN_BUDGET_MS);
      const outcome = await runTurn(deps.serviceDeps, deps.model, payload, { budget, shutdown: signal });
      if (outcome.kind === "retry")
        return {
          kind: "retry",
          errorCode: outcome.errorCode,
          retryAfterMs: outcome.errorCode === "shutdown" ? SHUTDOWN_RETRY_MS : MODEL_RETRY_MS,
        };
      return { kind: "ok" };
    },
  };
}
