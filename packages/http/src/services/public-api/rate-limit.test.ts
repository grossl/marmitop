// covers FR-143, 06.api-spec.md "Rate limits"
import { describe, expect, test } from "bun:test";

import { API_RATE_LIMITS, rateClassFor, rateLimitDecision, rateLimitHeaders } from "./rate-limit";

const NOW = new Date("2026-10-13T12:00:20.500Z");

describe("rate limits", () => {
  test("600 reads and 120 writes per minute (06)", () => {
    expect(API_RATE_LIMITS).toEqual({ read: 600, write: 120 });
    expect(rateClassFor("GET")).toBe("read");
    expect(rateClassFor("POST")).toBe("write");
    expect(rateClassFor("PATCH")).toBe("write");
  });

  test("under the limit: allowed, remaining counts down, reset is the window end in unix seconds", () => {
    const d = rateLimitDecision(119, 120, NOW);
    expect(d).toEqual({ allowed: true, limit: 120, remaining: 1, resetAt: 1791892860, retryAfterSeconds: 40 });
    expect(rateLimitHeaders(d)).toEqual({
      "X-RateLimit-Limit": "120",
      "X-RateLimit-Remaining": "1",
      "X-RateLimit-Reset": "1791892860",
    });
  });

  test("at the limit the request still passes; one over is refused with Retry-After", () => {
    expect(rateLimitDecision(120, 120, NOW).allowed).toBe(true);
    const over = rateLimitDecision(121, 120, NOW);
    expect(over.allowed).toBe(false);
    expect(over.remaining).toBe(0);
    expect(over.retryAfterSeconds).toBe(40);
  });
});
