// covers FR-080, FR-005, FR-006, FR-008, NFR-001
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AppError } from "@mt/core";
import type { Db } from "@mt/db";
import { createTestDb, type RestaurantFixture, seedRestaurant } from "@mt/db/test-harness";

import type { ServiceDeps } from "../deps";
import { createTestServiceDeps, userCtx } from "../testing";
import { getRestaurantProfile, updateRestaurantProfile } from "./restaurant-profile";

let db: Db;
let deps: ServiceDeps;
let a: RestaurantFixture;
let b: RestaurantFixture;

const code = (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`);

beforeAll(async () => {
  db = await createTestDb();
  deps = createTestServiceDeps(db);
  a = await seedRestaurant(db, "profile-a");
  b = await seedRestaurant(db, "profile-b");
});

afterAll(async () => {
  await db.end();
});

describe("getRestaurantProfile", () => {
  test("an admin reads the profile", async () => {
    const profile = await getRestaurantProfile(deps, userCtx(a.restaurantId, a.adminId, "admin"), undefined);
    expect(profile).toMatchObject({
      id: a.restaurantId,
      name: "profile-a",
      cidade: "São Paulo",
      uf: "SP",
      codigoMunicipio: "3550308",
      planCode: "free",
    });
  });

  test("an attendant is refused", async () => {
    const error = await getRestaurantProfile(deps, userCtx(a.restaurantId, a.attendantId, "attendant"), undefined).catch(
      (e) => e,
    );
    expect(code(error)).toBe("forbidden");
  });

  test("an admin of A naming restaurant B in the context reads nothing", async () => {
    const error = await getRestaurantProfile(deps, userCtx(b.restaurantId, a.adminId, "admin"), undefined).catch(
      (e) => e,
    );
    expect(code(error)).toBe("not_found");
  });
});

describe("updateRestaurantProfile", () => {
  test("an admin updates the profile", async () => {
    const saved = await updateRestaurantProfile(deps, userCtx(a.restaurantId, a.adminId, "admin"), {
      name: "Marmita da Casa",
      phone: "(11) 99999-0000",
      email: "contato@casa.test",
      address: "Rua A, 1",
      cidade: "Campinas",
      uf: "SP",
      codigoMunicipio: "3509502",
    });
    expect(saved).toMatchObject({ name: "Marmita da Casa", cidade: "Campinas", codigoMunicipio: "3509502" });
    const [row] = await db<{ name: string }[]>`select name from public.restaurants where id = ${a.restaurantId}`;
    expect(row?.name).toBe("Marmita da Casa");
  });

  test("an attendant is refused", async () => {
    const error = await updateRestaurantProfile(deps, userCtx(a.restaurantId, a.attendantId, "attendant"), {
      name: "Hack",
    }).catch((e) => e);
    expect(code(error)).toBe("forbidden");
  });

  test("invalid input is validation_failed with a field path", async () => {
    const error = await updateRestaurantProfile(deps, userCtx(a.restaurantId, a.adminId, "admin"), {
      name: "",
      uf: "xx",
    }).catch((e) => e);
    expect(code(error)).toBe("validation_failed");
    expect((error as AppError).details?.map((d) => d.path)).toContain("name");
  });

  test("a forged admin role in the context still cannot write: RLS reads the role from data", async () => {
    const error = await updateRestaurantProfile(deps, userCtx(a.restaurantId, a.attendantId, "admin"), {
      name: "Forged",
    }).catch((e) => e);
    expect(code(error)).toBe("forbidden");
    const [row] = await db<{ name: string }[]>`select name from public.restaurants where id = ${a.restaurantId}`;
    expect(row?.name).not.toBe("Forged");
  });

  test("restaurant B is untouched", async () => {
    const [row] = await db<{ name: string }[]>`select name from public.restaurants where id = ${b.restaurantId}`;
    expect(row?.name).toBe("profile-b");
  });
});
