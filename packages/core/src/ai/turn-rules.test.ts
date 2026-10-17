// covers FR-181, FR-182, FR-183, FR-186, FR-189, FR-196, FR-197
import { describe, expect, test } from "bun:test";

import { aiQuotaState, checkPlaceOrder, decideEnqueue, decideTurnStart, overageAmountCents } from "./turn-rules";

const now = new Date("2026-10-17T15:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("aiQuotaState", () => {
  test.each([
    [{ used: 10, included: 300, allowOverage: false, hardCap: 20000 }, "included"],
    [{ used: 300, included: 300, allowOverage: false, hardCap: 20000 }, "blocked_quota"],
    [{ used: 300, included: 300, allowOverage: true, hardCap: 20000 }, "overage"],
    [{ used: 20000, included: 300, allowOverage: true, hardCap: 20000 }, "blocked_cap"],
    [{ used: 50, included: 300, allowOverage: false, hardCap: 50 }, "blocked_cap"],
  ] as const)("%o → %s", (input, expected) => {
    expect(aiQuotaState(input)).toBe(expected);
  });
});

describe("overageAmountCents", () => {
  test("rounds up to the next 100 replies", () => {
    expect(overageAmountCents({ used: 3250, included: 3000, pricePer100Cents: 500 })).toEqual({
      extra: 250,
      amountCents: 1500,
    });
    expect(overageAmountCents({ used: 10, included: 3000, pricePer100Cents: 500 })).toEqual({
      extra: 0,
      amountCents: 0,
    });
  });
});

describe("decideEnqueue", () => {
  const base = {
    enabled: true,
    aiMode: "auto" as const,
    pauseReason: null,
    pausedAt: null,
    autoResumeMinutes: 360,
    open: true,
    closedSent: false,
    quota: "included" as const,
    now,
  };
  test("all conditions true", () => expect(decideEnqueue(base)).toEqual({ kind: "enqueue", resume: false }));
  test("off, closed, closed notice sent", () => {
    expect(decideEnqueue({ ...base, enabled: false })).toEqual({ kind: "skip" });
    expect(decideEnqueue({ ...base, open: false })).toEqual({ kind: "skip" });
    expect(decideEnqueue({ ...base, closedSent: true })).toEqual({ kind: "skip" });
  });
  test("paused by an attendant resumes after auto_resume_minutes", () => {
    const paused = { ...base, aiMode: "paused" as const, pauseReason: "attendant" as const };
    expect(decideEnqueue({ ...paused, pausedAt: ago(10 * 60_000) })).toEqual({ kind: "skip" });
    expect(decideEnqueue({ ...paused, pausedAt: ago(361 * 60_000) })).toEqual({ kind: "enqueue", resume: true });
    expect(decideEnqueue({ ...paused, pausedAt: ago(999 * 60_000), autoResumeMinutes: 0 })).toEqual({ kind: "skip" });
  });
  test("a handoff pause never resumes by itself", () => {
    const paused = {
      ...base,
      aiMode: "paused" as const,
      pauseReason: "complaint" as const,
      pausedAt: ago(999 * 60_000),
    };
    expect(decideEnqueue(paused)).toEqual({ kind: "skip" });
  });
  test("blocked quota pauses", () => {
    expect(decideEnqueue({ ...base, quota: "blocked_quota" })).toEqual({ kind: "pause", reason: "quota" });
    expect(decideEnqueue({ ...base, quota: "blocked_cap" })).toEqual({ kind: "pause", reason: "cap" });
  });
});

describe("decideTurnStart", () => {
  const base = {
    triggerIsLatestInbound: true,
    aiMode: "auto" as const,
    outboundAfterTrigger: false,
    enqueuedAt: ago(9_000),
    now,
    claimedAt: null,
    quota: "included" as const,
  };
  test("run, billed included or overage", () => {
    expect(decideTurnStart(base)).toEqual({ kind: "run", billedAs: "included" });
    expect(decideTurnStart({ ...base, quota: "overage" })).toEqual({ kind: "run", billedAs: "overage" });
  });
  test.each([
    [{ triggerIsLatestInbound: false }, "superseded", null],
    [{ aiMode: "paused" }, "paused", null],
    [{ outboundAfterTrigger: true }, "answered", null],
    [{ enqueuedAt: ago(121_000) }, "stale", "stale"],
    [{ quota: "blocked_quota" }, "blocked", "quota"],
    [{ quota: "blocked_cap" }, "blocked", "cap"],
    [{ claimedAt: ago(5_000) }, "locked", null],
  ] as const)("%o → %s", (patch, status, pause) => {
    expect(decideTurnStart({ ...base, ...patch })).toEqual({ kind: "stop", status, pause });
  });
  test("a claim older than 120 seconds is ignored", () => {
    expect(decideTurnStart({ ...base, claimedAt: ago(121_000) }).kind).toBe("run");
  });
});

describe("checkPlaceOrder", () => {
  const ok = {
    status: "open" as const,
    version: 4,
    summaryVersion: 4,
    summarySentAt: ago(60_000),
    inboundAfterSummary: true,
    open: true,
    now,
  };
  test("confirmed", () => expect(checkPlaceOrder(ok)).toEqual({ ok: true }));
  test.each([
    [{ summaryVersion: null }],
    [{ summaryVersion: 3 }],
    [{ inboundAfterSummary: false }],
    [{ summarySentAt: ago(31 * 60_000) }],
    [{ status: "abandoned" as const }],
  ])("%o → not_confirmed", (patch) => {
    expect(checkPlaceOrder({ ...ok, ...patch })).toEqual({ ok: false, code: "not_confirmed" });
  });
  test("closed", () => expect(checkPlaceOrder({ ...ok, open: false })).toEqual({ ok: false, code: "closed" }));
});
