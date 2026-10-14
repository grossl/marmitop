// covers FR-144, NFR-011
import { describe, expect, test } from "bun:test";
import { AppError, DEFAULT_HTTP_STATUS, ERROR_CODES } from "./errors";

describe("AppError", () => {
  test("maps every code to the HTTP status in 04.architecture.md", () => {
    expect(DEFAULT_HTTP_STATUS).toEqual({
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
    });
    expect(ERROR_CODES.length).toBe(18);
  });

  test("renders the one JSON envelope with details", () => {
    const err = new AppError("validation_failed", "bad body", {
      details: [{ path: "items[0].qty", code: "too_small", message: "min 1" }],
    });
    expect(err.httpStatus).toBe(422);
    expect(err.toErrorBody()).toEqual({
      error: {
        code: "validation_failed",
        message: "bad body",
        details: [{ path: "items[0].qty", code: "too_small", message: "min 1" }],
      },
    });
  });

  test("omits details when empty and allows a status override", () => {
    const err = new AppError("internal_error", "boom", { httpStatus: 503 });
    expect(err.httpStatus).toBe(503);
    expect(err.toErrorBody()).toEqual({ error: { code: "internal_error", message: "boom" } });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AppError");
  });
});
