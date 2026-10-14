// Per-key rate limits for the public API (FR-143; 06.api-spec.md "Rate limits";
// 07.security.md). Fixed one-minute windows in `rate_counters`, so the limit holds
// across api instances. Every response carries X-RateLimit-*; over the limit the
// route answers 429 rate_limited with Retry-After.

import type { ServiceDeps } from "../../deps";
import { hitRateCounter } from "../whatsapp/inbound-webhook";

export type RateClass = "read" | "write";

export const API_RATE_LIMITS: Readonly<Record<RateClass, number>> = { read: 600, write: 120 };

export function rateClassFor(method: string): RateClass {
  return method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD" ? "read" : "write";
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Unix seconds when the window ends. */
  readonly resetAt: number;
  readonly retryAfterSeconds: number;
}

/** `count` includes this request. */
export function rateLimitDecision(count: number, limit: number, now: Date): RateLimitDecision {
  const windowEnd = Math.floor(now.getTime() / 60_000) * 60_000 + 60_000;
  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt: windowEnd / 1000,
    retryAfterSeconds: Math.max(1, Math.ceil((windowEnd - now.getTime()) / 1000)),
  };
}

export function rateLimitHeaders(d: RateLimitDecision): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(d.limit),
    "X-RateLimit-Remaining": String(d.remaining),
    "X-RateLimit-Reset": String(d.resetAt),
  };
}

export interface ApiRateLimiter {
  hit(apiKeyId: string, cls: RateClass, now: Date): Promise<RateLimitDecision>;
}

export function createDbApiRateLimiter(deps: ServiceDeps): ApiRateLimiter {
  return {
    async hit(apiKeyId, cls, now) {
      const limit = API_RATE_LIMITS[cls];
      const result = await hitRateCounter(deps.db, apiKeyId, cls, limit, now);
      return rateLimitDecision(result.count, limit, now);
    },
  };
}
