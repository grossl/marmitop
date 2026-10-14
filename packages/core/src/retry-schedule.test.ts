// covers FR-108, FR-137, NFR-022, NFR-032
import { describe, expect, test } from "bun:test";
import {
  classifyOutboundSend,
  classifyUpstreamFailure,
  decideAfterFailure,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
  retryDelayMs,
} from "./retry-schedule";

const MIN = 60_000;
const HOUR = 60 * MIN;

describe("retry schedule (ADR-007)", () => {
  test("delays are 1 m, 5 m, 30 m, 2 h, 8 h and there are six attempts", () => {
    expect(RETRY_DELAYS_MS).toEqual([1 * MIN, 5 * MIN, 30 * MIN, 2 * HOUR, 8 * HOUR]);
    expect(MAX_ATTEMPTS).toBe(6);
  });
  test("retryDelayMs(n) is the delay after the n-th failed attempt, null after the last", () => {
    expect([1, 2, 3, 4, 5].map(retryDelayMs)).toEqual([1 * MIN, 5 * MIN, 30 * MIN, 2 * HOUR, 8 * HOUR]);
    expect(retryDelayMs(6)).toBeNull();
    expect(() => retryDelayMs(0)).toThrow();
  });
});

describe("decideAfterFailure", () => {
  test("transient failures retry on the schedule, six attempts in total", () => {
    const outcomes = [1, 2, 3, 4, 5, 6].map((n) => decideAfterFailure({ attemptNo: n, failure: "transient" }));
    expect(outcomes.slice(0, 5).every((o) => o.action === "retry")).toBe(true);
    expect(outcomes[5]).toEqual({ action: "fail", reason: "exhausted" });
  });
  test("permanent failures stop at once", () => {
    expect(decideAfterFailure({ attemptNo: 1, failure: "permanent" })).toEqual({ action: "fail", reason: "permanent" });
  });
  test("ambiguous failures stop at once (ADR-017)", () => {
    expect(decideAfterFailure({ attemptNo: 1, failure: "ambiguous" })).toEqual({ action: "fail", reason: "ambiguous" });
  });
  test("Retry-After extends a delay but never shortens it", () => {
    expect(decideAfterFailure({ attemptNo: 1, failure: "transient", retryAfterMs: 10 * MIN })).toEqual({
      action: "retry",
      delayMs: 10 * MIN,
    });
    expect(decideAfterFailure({ attemptNo: 2, failure: "transient", retryAfterMs: 1000 })).toEqual({
      action: "retry",
      delayMs: 5 * MIN,
    });
  });
});

describe("classifyOutboundSend (ADR-017, FR-108)", () => {
  test("a connection error before the request left is transient", () => {
    expect(classifyOutboundSend({ kind: "connection_error" })).toEqual({
      failure: "transient",
      errorCode: "connection_error",
    });
  });
  test("a timeout after the request left is ambiguous", () => {
    expect(classifyOutboundSend({ kind: "timeout" })).toEqual({ failure: "ambiguous", errorCode: "ambiguous" });
  });
  test("a 5xx is ambiguous", () => {
    expect(classifyOutboundSend({ kind: "http", status: 502 })).toEqual({
      failure: "ambiguous",
      errorCode: "ambiguous",
    });
  });
  test("422 outside_service_window and whatsapp_disconnected are permanent with their own code", () => {
    expect(classifyOutboundSend({ kind: "http", status: 422, code: "outside_service_window" })).toEqual({
      failure: "permanent",
      errorCode: "outside_service_window",
    });
    expect(classifyOutboundSend({ kind: "http", status: 422, code: "whatsapp_disconnected" })).toEqual({
      failure: "permanent",
      errorCode: "whatsapp_disconnected",
    });
  });
  test("other 4xx are permanent", () => {
    expect(classifyOutboundSend({ kind: "http", status: 401, code: "unauthorized" })).toEqual({
      failure: "permanent",
      errorCode: "unauthorized",
    });
    expect(classifyOutboundSend({ kind: "http", status: 422 })).toEqual({
      failure: "permanent",
      errorCode: "validation_failed",
    });
  });
  test("429 is transient", () => {
    expect(classifyOutboundSend({ kind: "http", status: 429 }).failure).toBe("transient");
  });
});

describe("classifyUpstreamFailure (polls, invoices, webhooks: idempotent calls)", () => {
  test("timeout, connection error, and 5xx retry; 429 retries", () => {
    expect(classifyUpstreamFailure({ kind: "timeout" }).failure).toBe("transient");
    expect(classifyUpstreamFailure({ kind: "connection_error" }).failure).toBe("transient");
    expect(classifyUpstreamFailure({ kind: "http", status: 503 }).failure).toBe("transient");
    expect(classifyUpstreamFailure({ kind: "http", status: 429 }).failure).toBe("transient");
  });
  test("4xx stop", () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(classifyUpstreamFailure({ kind: "http", status }).failure).toBe("permanent");
    }
  });
});
