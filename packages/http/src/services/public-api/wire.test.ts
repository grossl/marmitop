// covers FR-144 (details[].path is relative to the snake_case request body)
import { describe, expect, test } from "bun:test";
import { AppError } from "@mt/core";

import { toWireError } from "./wire";

describe("toWireError", () => {
  test("camelCase detail paths become snake_case body paths", () => {
    const e = new AppError("validation_failed", "x", {
      details: [
        { path: "customerId", code: "not_found", message: "m" },
        { path: "items[0].menuItemId", code: "item_unavailable", message: "m" },
        { path: "logradouro", code: "required", message: "m" },
      ],
    });
    const out = toWireError(e);
    expect(out.status).toBe(422);
    expect(out.body.error.details.map((d) => d.path)).toEqual(["customer_id", "items[0].menu_item_id", "logradouro"]);
  });

  test("a header name in a path stays as it is", () => {
    const out = toWireError(
      new AppError("validation_failed", "x", { details: [{ path: "Idempotency-Key", code: "c", message: "m" }] }),
    );
    expect(out.body.error.details[0]?.path).toBe("Idempotency-Key");
  });

  test("an error without details still carries details: []", () => {
    const out = toWireError(new AppError("not_found", "Order not found."));
    expect(out).toEqual({
      status: 404,
      unexpected: false,
      body: { error: { code: "not_found", message: "Order not found.", details: [] } },
    });
  });

  test("an unknown error is a 500 internal_error without its message", () => {
    const out = toWireError(new Error("password=hunter2"));
    expect(out.status).toBe(500);
    expect(out.unexpected).toBe(true);
    expect(JSON.stringify(out.body)).not.toContain("hunter2");
  });
});
