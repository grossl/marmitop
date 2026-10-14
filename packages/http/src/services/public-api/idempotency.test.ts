// covers FR-145, 06.api-spec.md "Idempotency" (claim, replay, conflict, in progress, takeover)
import { describe, expect, test } from "bun:test";
import { AppError } from "@mt/core";

import {
  decideIdempotency,
  IDEMPOTENCY_STALE_AFTER_MS,
  idempotencyRequestHash,
  isStaleClaim,
  parseIdempotencyKey,
} from "./idempotency";

describe("idempotencyRequestHash", () => {
  test("is stable for the same method, path, and body bytes", () => {
    const a = idempotencyRequestHash("POST", "/v1/orders", '{"a":1}');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(idempotencyRequestHash("POST", "/v1/orders", '{"a":1}')).toBe(a);
  });

  test("changes with the body, the path, or the method", () => {
    const a = idempotencyRequestHash("POST", "/v1/orders", '{"a":1}');
    expect(idempotencyRequestHash("POST", "/v1/orders", '{"a":2}')).not.toBe(a);
    expect(idempotencyRequestHash("POST", "/v1/customers", '{"a":1}')).not.toBe(a);
    expect(idempotencyRequestHash("PATCH", "/v1/orders", '{"a":1}')).not.toBe(a);
  });
});

describe("decideIdempotency (after a claim found an existing row)", () => {
  const completed = { status: "completed" as const, requestHash: "h1", responseStatus: 201, responseBody: { id: "x" } };
  const inProgress = { status: "in_progress" as const, requestHash: "h1", responseStatus: null, responseBody: null };

  test("completed with the same hash: replay the stored response", () => {
    expect(decideIdempotency(completed, "h1")).toEqual({ kind: "replay", status: 201, body: { id: "x" } });
  });

  test("another hash: 409 idempotency_conflict, completed or in progress", () => {
    for (const row of [completed, inProgress]) {
      const d = decideIdempotency(row, "h2");
      expect(d.kind).toBe("refuse");
      if (d.kind === "refuse") expect(d.error.code).toBe("idempotency_conflict");
    }
  });

  test("in progress with the same hash: 409 idempotency_in_progress, retry after 1 s", () => {
    const d = decideIdempotency(inProgress, "h1");
    expect(d.kind).toBe("refuse");
    if (d.kind === "refuse") {
      expect(d.error.code).toBe("idempotency_in_progress");
      expect(d.error.httpStatus).toBe(409);
      expect(d.retryAfterSeconds).toBe(1);
    }
  });
});

describe("isStaleClaim", () => {
  test("an in-progress claim older than 60 s may be taken over", () => {
    const now = new Date("2026-10-13T12:01:00Z");
    expect(IDEMPOTENCY_STALE_AFTER_MS).toBe(60_000);
    expect(isStaleClaim(new Date("2026-10-13T12:00:00Z"), now)).toBe(false);
    expect(isStaleClaim(new Date("2026-10-13T11:59:59.999Z"), now)).toBe(true);
  });
});

describe("parseIdempotencyKey", () => {
  test("absent is null; 1 to 255 characters pass", () => {
    expect(parseIdempotencyKey(undefined)).toBeNull();
    expect(parseIdempotencyKey("k-1")).toBe("k-1");
    expect(parseIdempotencyKey("a".repeat(255))).toBe("a".repeat(255));
  });

  test("empty or over 255 characters is 422 on the Idempotency-Key header", () => {
    for (const bad of ["", "a".repeat(256)]) {
      const e = (() => {
        try {
          parseIdempotencyKey(bad);
        } catch (x) {
          return x;
        }
      })() as AppError;
      expect(e).toBeInstanceOf(AppError);
      expect(e.code).toBe("validation_failed");
      expect(e.details?.[0]?.path).toBe("Idempotency-Key");
    }
  });
});
