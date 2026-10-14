// Error model (04.architecture.md "Error model", 06.api-spec.md "Error format", FR-144).
//
// Services throw AppError. apps/api renders the envelope, Server Actions return
// { ok: false, error }, the worker maps it to retry or fail. The message never
// carries a secret (NFR-011).

export const ERROR_CODES = [
  "unauthorized",
  "forbidden",
  "not_found",
  "validation_failed",
  "conflict",
  "idempotency_conflict",
  "idempotency_in_progress",
  "rate_limited",
  "signature_invalid",
  "invalid_status_transition",
  "item_unavailable",
  "whatsapp_not_configured",
  "whatsapp_disconnected",
  "outside_service_window",
  "fiscal_not_configured",
  "invoice_not_allowed",
  "upstream_error",
  "internal_error",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const DEFAULT_HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  conflict: 409,
  idempotency_conflict: 409,
  idempotency_in_progress: 409,
  rate_limited: 429,
  signature_invalid: 401,
  invalid_status_transition: 422,
  item_unavailable: 422,
  whatsapp_not_configured: 422,
  whatsapp_disconnected: 422,
  outside_service_window: 422,
  fiscal_not_configured: 422,
  invoice_not_allowed: 422,
  upstream_error: 502,
  internal_error: 500,
};

/** One entry of `error.details[]`. `path` is relative to the request body root. */
export interface ErrorDetail {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface ErrorBody {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly details?: readonly ErrorDetail[];
  };
}

export interface AppErrorOptions {
  readonly details?: readonly ErrorDetail[];
  readonly httpStatus?: number;
  readonly cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: readonly ErrorDetail[] | undefined;
  readonly httpStatus: number;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.details = options.details;
    this.httpStatus = options.httpStatus ?? DEFAULT_HTTP_STATUS[code];
  }

  toErrorBody(): ErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && this.details.length > 0 ? { details: this.details } : {}),
      },
    };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
