// covers FR-006, FR-008 — the role check runs before any database work (ADR-005)
import { describe, expect, test } from "bun:test";
import { AppError } from "@mt/core";
import type { Db } from "@mt/db";
import { z } from "zod";

import type { ServiceContext } from "./context";
import type { ServiceDeps } from "./deps";
import { defineService } from "./service";

/** A Db that fails the test if anything touches it. */
const untouchableDb = new Proxy(() => {}, {
  get: () => {
    throw new Error("the database was touched");
  },
  apply: () => {
    throw new Error("the database was touched");
  },
}) as unknown as Db;

const deps = { db: untouchableDb } as unknown as ServiceDeps;

const attendant: ServiceContext = {
  restaurantId: "00000000-0000-4000-8000-000000000001",
  actorType: "user",
  userId: "00000000-0000-4000-8000-000000000002",
  role: "attendant",
};

const adminOnly = defineService({
  name: "test.adminOnly",
  minRole: "admin",
  input: z.object({ name: z.string().min(1) }),
  run: async () => "ran",
});

describe("defineService", () => {
  test("refuses a lower role before opening a transaction", async () => {
    const error = await adminOnly(deps, attendant, { name: "x" }).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("forbidden");
  });

  test("rejects invalid input with validation_failed before opening a transaction", async () => {
    const error = await adminOnly(deps, { ...attendant, role: "admin" }, { name: "" }).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("validation_failed");
  });

  test("exposes its name and minimum role", () => {
    expect(adminOnly.serviceName).toBe("test.adminOnly");
    expect(adminOnly.minRole).toBe("admin");
  });
});
