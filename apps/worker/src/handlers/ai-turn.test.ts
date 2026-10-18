// covers FR-182, FR-198
import { describe, expect, test } from "bun:test";
import { ScriptedAssistantModel } from "@mt/core";
import type { ServiceDeps } from "@mt/http";

import { createAiTurnHandler } from "./ai-turn";

const payload = {
  v: 1 as const,
  restaurantId: crypto.randomUUID(),
  conversationId: crypto.randomUUID(),
  triggerMessageId: crypto.randomUUID(),
  enqueuedAt: new Date().toISOString(),
};

describe("ai turn handler", () => {
  test("queue, subject, and schema", () => {
    const h = createAiTurnHandler({
      serviceDeps: {} as ServiceDeps,
      model: new ScriptedAssistantModel([]),
      runTurn: async () => ({ kind: "done", status: "replied", runId: "r" }),
    });
    expect(h.queue).toBe("mt_ai_turns");
    expect(h.subjectType).toBe("ai_turn");
    expect(h.subjectId(payload)).toBe(payload.conversationId);
    expect(h.schema.safeParse(payload).success).toBe(true);
  });
  test("maps outcomes to job outcomes", async () => {
    const ctx = {
      queue: "mt_ai_turns" as const,
      msgId: 1,
      payload,
      attempt: 1,
      readCount: 1,
      signal: new AbortController().signal,
    };
    const done = createAiTurnHandler({
      serviceDeps: {} as ServiceDeps,
      model: new ScriptedAssistantModel([]),
      runTurn: async () => ({ kind: "done", status: "failed", runId: "r" }),
    });
    expect(await done.run(ctx)).toEqual({ kind: "ok" });
    const retry = createAiTurnHandler({
      serviceDeps: {} as ServiceDeps,
      model: new ScriptedAssistantModel([]),
      runTurn: async () => ({ kind: "retry", errorCode: "overloaded", runId: "r" }),
    });
    expect(await retry.run(ctx)).toEqual({ kind: "retry", errorCode: "overloaded", retryAfterMs: 20_000 });
  });
  test("passes the job signal as shutdown and a separate turn budget", async () => {
    const controller = new AbortController();
    let seen: { budget?: AbortSignal; shutdown?: AbortSignal } | undefined;
    const h = createAiTurnHandler({
      serviceDeps: {} as ServiceDeps,
      model: new ScriptedAssistantModel([]),
      runTurn: async (_deps, _model, _job, signals) => {
        seen = signals;
        return { kind: "done", status: "replied", runId: "r" };
      },
    });
    await h.run({ queue: "mt_ai_turns", msgId: 1, payload, attempt: 1, readCount: 1, signal: controller.signal });
    expect(seen?.shutdown).toBe(controller.signal);
    expect(seen?.budget).toBeInstanceOf(AbortSignal);
    controller.abort();
    // A shutdown does not abort the budget: runAiTurn tells the two apart (I2).
    expect(seen?.budget?.aborted).toBe(false);
  });
  test("a shutdown retry comes back after 5 seconds", async () => {
    const h = createAiTurnHandler({
      serviceDeps: {} as ServiceDeps,
      model: new ScriptedAssistantModel([]),
      runTurn: async () => ({ kind: "retry", errorCode: "shutdown", runId: "r" }),
    });
    const ctx = { queue: "mt_ai_turns" as const, msgId: 1, payload, attempt: 1, readCount: 1 };
    expect(await h.run({ ...ctx, signal: new AbortController().signal })).toEqual({
      kind: "retry",
      errorCode: "shutdown",
      retryAfterMs: 5_000,
    });
  });
});
