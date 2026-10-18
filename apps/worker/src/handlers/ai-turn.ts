// mt_ai_turns: one assistant turn per inbound burst (12.ai-order-assistant.md "Flow", ADR-025).
// A failed turn has already recorded its ai_runs row; the framework only retries transient model errors,
// 20 seconds later, and runAiTurn turns a job older than 120 seconds into `stale`.

import type { AssistantModel } from "@mt/core";
import { QUEUES } from "@mt/db";
import { type AiTurnOutcome, runAiTurn, type ServiceDeps } from "@mt/http";
import { type AiTurnJob, aiTurnJobSchema } from "@mt/schemas";

import type { JobHandler } from "../framework/types";

export interface AiTurnHandlerDeps {
  readonly serviceDeps: ServiceDeps;
  readonly model: AssistantModel;
  /** Injected in tests. */
  readonly runTurn?: (deps: ServiceDeps, model: AssistantModel, job: AiTurnJob) => Promise<AiTurnOutcome>;
}

export function createAiTurnHandler(deps: AiTurnHandlerDeps): JobHandler<AiTurnJob> {
  const runTurn = deps.runTurn ?? runAiTurn;
  return {
    name: "ai.turn",
    queue: QUEUES.aiTurns,
    schema: aiTurnJobSchema,
    subjectType: "ai_turn",
    subjectId: (job) => job.conversationId,
    visibilityTimeoutSeconds: 180,
    async run({ payload }) {
      const outcome = await runTurn(deps.serviceDeps, deps.model, payload);
      if (outcome.kind === "retry") return { kind: "retry", errorCode: outcome.errorCode, retryAfterMs: 20_000 };
      return { kind: "ok" };
    },
  };
}
