// covers FR-005, FR-006
import { describe, expect, test } from "bun:test";
import { AppError } from "@mt/core";

import type { ServiceContext } from "../context";
import { hasRole, requireRole } from "./roles";

const ctx = (role: ServiceContext["role"]): ServiceContext => ({
  restaurantId: "00000000-0000-4000-8000-000000000001",
  actorType: "user",
  userId: "00000000-0000-4000-8000-000000000002",
  role,
});

describe("role guard", () => {
  test("admin meets admin and attendant", () => {
    expect(hasRole(ctx("admin"), "admin")).toBe(true);
    expect(hasRole(ctx("admin"), "attendant")).toBe(true);
  });

  test("attendant meets attendant only", () => {
    expect(hasRole(ctx("attendant"), "attendant")).toBe(true);
    expect(hasRole(ctx("attendant"), "admin")).toBe(false);
  });

  test("requireRole throws forbidden for a lower role", () => {
    try {
      requireRole(ctx("attendant"), "admin");
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("forbidden");
    }
  });
});
