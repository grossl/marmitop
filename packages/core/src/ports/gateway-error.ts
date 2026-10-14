// One error type for every outbound adapter (WhatsApp, invoices, webhooks). The worker feeds
// `failure` to the retry classifiers in retry-schedule.ts.

import type { CallFailure } from "../retry-schedule";

export class GatewayError extends Error {
  readonly failure: CallFailure;
  /** Seconds-based `Retry-After`, in milliseconds, when the remote sent one. */
  readonly retryAfterMs: number | undefined;

  constructor(failure: CallFailure, message?: string, retryAfterMs?: number) {
    super(message ?? describe(failure));
    this.name = "GatewayError";
    this.failure = failure;
    this.retryAfterMs = retryAfterMs;
  }

  static http(status: number, code?: string, message?: string): GatewayError {
    return new GatewayError({ kind: "http", status, ...(code ? { code } : {}) }, message);
  }
  static timeout(): GatewayError {
    return new GatewayError({ kind: "timeout" });
  }
  static connection(): GatewayError {
    return new GatewayError({ kind: "connection_error" });
  }
}

function describe(f: CallFailure): string {
  if (f.kind === "http") return `Remote returned HTTP ${f.status}${f.code ? ` (${f.code})` : ""}`;
  return f.kind === "timeout" ? "Remote call timed out" : "Could not connect to the remote";
}
