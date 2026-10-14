// Retry schedule and job-attempt rules (ADR-007, ADR-017; FR-108, FR-137, NFR-022, NFR-032).
// Backoff after a failed attempt: 1 m, 5 m, 30 m, 2 h, 8 h. Six attempts in total.

const MIN = 60_000;
const HOUR = 60 * MIN;

export const RETRY_DELAYS_MS: readonly number[] = [1 * MIN, 5 * MIN, 30 * MIN, 2 * HOUR, 8 * HOUR];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/** Delay after the n-th failed attempt (1-based). Null after the last attempt. */
export function retryDelayMs(attemptNo: number): number | null {
  if (!Number.isInteger(attemptNo) || attemptNo < 1) throw new RangeError("attemptNo must be an integer >= 1");
  return RETRY_DELAYS_MS[attemptNo - 1] ?? null;
}

/**
 * - transient: try again later
 * - permanent: the remote system refused; no retry
 * - ambiguous: the request may have been processed (outbound send after it left); no retry (ADR-017)
 */
export type FailureClass = "transient" | "permanent" | "ambiguous";

export type RetryDecision =
  | { readonly action: "retry"; readonly delayMs: number }
  | { readonly action: "fail"; readonly reason: "permanent" | "ambiguous" | "exhausted" };

export function decideAfterFailure(input: {
  readonly attemptNo: number;
  readonly failure: FailureClass;
  /** From a `Retry-After` header. It can lengthen a delay, never shorten it. */
  readonly retryAfterMs?: number;
}): RetryDecision {
  if (input.failure === "permanent") return { action: "fail", reason: "permanent" };
  if (input.failure === "ambiguous") return { action: "fail", reason: "ambiguous" };
  const base = retryDelayMs(input.attemptNo);
  if (base === null) return { action: "fail", reason: "exhausted" };
  return { action: "retry", delayMs: Math.max(base, input.retryAfterMs ?? 0) };
}

export type CallFailure =
  | { readonly kind: "connection_error" }
  | { readonly kind: "timeout" }
  | { readonly kind: "http"; readonly status: number; readonly code?: string };

export interface Classified {
  readonly failure: FailureClass;
  readonly errorCode: string;
}

function codeForStatus(status: number, code: string | undefined): string {
  if (code) return code;
  switch (status) {
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 429:
      return "rate_limited";
    case 400:
    case 422:
      return "validation_failed";
    default:
      return status >= 500 ? "upstream_error" : "validation_failed";
  }
}

/**
 * Outbound WhatsApp send (backend-uatis has no idempotency key). A connection error before
 * the request left retries. A timeout, or a 5xx after the request left, is ambiguous and is
 * never retried automatically. A 4xx refusal is permanent.
 */
export function classifyOutboundSend(failure: CallFailure): Classified {
  if (failure.kind === "connection_error") return { failure: "transient", errorCode: "connection_error" };
  if (failure.kind === "timeout") return { failure: "ambiguous", errorCode: "ambiguous" };
  if (failure.status >= 500) return { failure: "ambiguous", errorCode: "ambiguous" };
  if (failure.status === 429) return { failure: "transient", errorCode: "rate_limited" };
  return { failure: "permanent", errorCode: codeForStatus(failure.status, failure.code) };
}

/** Idempotent upstream calls (polls, invoices, webhook deliveries): transient errors retry. */
export function classifyUpstreamFailure(failure: CallFailure): Classified {
  if (failure.kind === "connection_error") return { failure: "transient", errorCode: "connection_error" };
  if (failure.kind === "timeout") return { failure: "transient", errorCode: "timeout" };
  if (failure.status >= 500) return { failure: "transient", errorCode: "upstream_error" };
  if (failure.status === 429) return { failure: "transient", errorCode: "rate_limited" };
  return { failure: "permanent", errorCode: codeForStatus(failure.status, failure.code) };
}
