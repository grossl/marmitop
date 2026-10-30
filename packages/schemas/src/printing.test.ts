// covers FR-251, FR-252
import { describe, expect, test } from "bun:test";

import { claimPrintJobsBodySchema, printJobResultBodySchema } from "./printing";

describe("print job bodies", () => {
  test("claim limit defaults to 5 and stays within 1..10", () => {
    expect(claimPrintJobsBodySchema.parse({})).toEqual({ limit: 5 });
    expect(claimPrintJobsBodySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(claimPrintJobsBodySchema.safeParse({ limit: 11 }).success).toBe(false);
    expect(claimPrintJobsBodySchema.safeParse({ limit: 3, extra: 1 }).success).toBe(false);
  });

  test("result needs printed; error is at most 500 characters", () => {
    expect(printJobResultBodySchema.parse({ printed: true })).toEqual({ printed: true });
    expect(printJobResultBodySchema.safeParse({}).success).toBe(false);
    expect(printJobResultBodySchema.safeParse({ printed: false, error: "x".repeat(501) }).success).toBe(false);
  });
});
