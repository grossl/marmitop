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
  static network(): GatewayError {
    return new GatewayError({ kind: "network_error" });
  }
  static refused(code: string, message?: string): GatewayError {
    return new GatewayError({ kind: "refused", code }, message);
  }
}

function describe(f: CallFailure): string {
  switch (f.kind) {
    case "http":
      return `Remote returned HTTP ${f.status}${f.code ? ` (${f.code})` : ""}`;
    case "timeout":
      return "Remote call timed out";
    case "network_error":
      return "The connection broke after the request was sent";
    case "refused":
      return `The request was refused before it left (${f.code})`;
    default:
      return "Could not connect to the remote";
  }
}
