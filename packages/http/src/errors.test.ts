// covers FR-144, NFR-011 (04.architecture.md "Error model")
import { describe, expect, test } from "bun:test";
import { AppError } from "@mt/core";
import { z } from "zod";

import { mapError, toActionError } from "./errors";

describe("mapError", () => {
  test("keeps an AppError's code, status, and details", () => {
    const mapped = mapError(
      new AppError("validation_failed", "bad", { details: [{ path: "name", code: "too_small", message: "x" }] }),
    );
    expect(mapped.status).toBe(422);
    expect(mapped.code).toBe("validation_failed");
    expect(mapped.body.error.details?.[0]?.path).toBe("name");
    expect(mapped.unexpected).toBe(false);
  });

  test("a ZodError becomes validation_failed with details", () => {
    const parsed = z.object({ name: z.string() }).safeParse({});
    if (parsed.success) throw new Error("expected failure");
    const mapped = mapError(parsed.error);
    expect(mapped.code).toBe("validation_failed");
    expect(mapped.body.error.details?.[0]?.path).toBe("name");
  });

  test("a Postgres unique violation becomes conflict", () => {
    const mapped = mapError(Object.assign(new Error("duplicate key value"), { code: "23505" }));
    expect(mapped.code).toBe("conflict");
    expect(mapped.status).toBe(409);
  });

  test("a Postgres privilege error becomes forbidden", () => {
    expect(mapError(Object.assign(new Error("permission denied"), { code: "42501" })).code).toBe("forbidden");
  });

  test("anything else is internal_error and leaks nothing", () => {
    const mapped = mapError(new Error("connection to 10.0.0.1 password=hunter2 failed"));
    expect(mapped.code).toBe("internal_error");
    expect(mapped.status).toBe(500);
    expect(mapped.unexpected).toBe(true);
    expect(JSON.stringify(mapped.body)).not.toContain("hunter2");
  });
});

describe("toActionError", () => {
  test("uses pt-BR copy for the code and flattens details to field errors", () => {
    const err = toActionError(
      new AppError("validation_failed", "The request body is invalid.", {
        details: [{ path: "uf", code: "invalid", message: "UF inválida." }],
      }),
    );
    expect(err.code).toBe("validation_failed");
    expect(err.message).toBe("Alguns campos precisam de correção.");
    expect(err.fieldErrors).toEqual({ uf: "UF inválida." });
  });

  test("forbidden reads as a permission message", () => {
    expect(toActionError(new AppError("forbidden", "x")).message).toBe("Você não tem permissão para esta ação.");
  });
});
