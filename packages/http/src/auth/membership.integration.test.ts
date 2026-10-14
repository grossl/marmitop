// covers FR-004, FR-008, NFR-001 — the caller's restaurant and role come from
// restaurant_members, never from the client (ADR-004, ADR-005).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Db } from "@mt/db";
import { createTestDb, createUser, type RestaurantFixture, seedRestaurant } from "@mt/db/test-harness";

import type { ServiceDeps } from "../deps";
import { createTestServiceDeps } from "../testing";
import { listMemberships, loadMembership, resolveUserContext } from "./membership";

let db: Db;
let deps: ServiceDeps;
let a: RestaurantFixture;
let b: RestaurantFixture;
let outsider: string;

beforeAll(async () => {
  db = await createTestDb();
  deps = createTestServiceDeps(db);
  a = await seedRestaurant(db, "membership-a");
  b = await seedRestaurant(db, "membership-b");
  outsider = await createUser(db, "membership-outsider");
});

afterAll(async () => {
  await db.end();
});

describe("listMemberships", () => {
  test("returns the caller's restaurant with its name and role", async () => {
    const rows = await listMemberships(deps, a.adminId);
    expect(rows).toEqual([{ restaurantId: a.restaurantId, restaurantName: "membership-a", role: "admin" }]);
    const attendant = await listMemberships(deps, a.attendantId);
    expect(attendant[0]?.role).toBe("attendant");
  });

  test("a user with no membership gets an empty list", async () => {
    expect(await listMemberships(deps, outsider)).toEqual([]);
  });
});

describe("loadMembership", () => {
  test("finds the role in the user's own restaurant", async () => {
    expect(await loadMembership(deps, a.adminId, a.restaurantId)).toEqual({
      restaurantId: a.restaurantId,
      role: "admin",
    });
  });

  test("returns null for another restaurant", async () => {
    expect(await loadMembership(deps, a.adminId, b.restaurantId)).toBeNull();
  });
});

describe("resolveUserContext", () => {
  test("builds a user context from data", async () => {
    expect(await resolveUserContext(deps, a.attendantId)).toEqual({
      actorType: "user",
      userId: a.attendantId,
      restaurantId: a.restaurantId,
      role: "attendant",
    });
  });

  test("returns null when the user belongs to no restaurant", async () => {
    expect(await resolveUserContext(deps, outsider)).toBeNull();
  });
});
