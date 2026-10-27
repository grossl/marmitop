// covers FR-220, FR-221, FR-222, FR-225, NFR-001
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Db } from "@mt/db";
import { createTestDb, errorCode, RAISE_EXCEPTION, type RestaurantFixture, seedRestaurant } from "@mt/db/test-harness";

import type { ServiceDeps } from "../../deps";
import { createTestServiceDeps, userCtx } from "../../testing";
import { archiveMenuItem, saveMenuItem } from "./menu";
import { getPublicMenu, PUBLIC_ID_PATTERN } from "./public-menu";

let db: Db;
let deps: ServiceDeps;
let a: RestaurantFixture;
let b: RestaurantFixture;
let publicIdA: string;
let publicIdB: string;

const meal = {
  kind: "meal" as const,
  description: "Arroz, feijão e frango",
  category: "proteinas",
  priceCents: 1890,
  calories: 520,
  available: true,
  popular: false,
  availableWeekdays: [1, 2, 3, 4, 5],
  ncm: "21069090",
  cfop: "5102",
};

async function publicIdOf(restaurantId: string): Promise<string> {
  const [row] = await db<{ public_id: string }[]>`select public_id from public.restaurants where id = ${restaurantId}`;
  if (row === undefined) throw new Error("restaurant not found");
  return row.public_id;
}

beforeAll(async () => {
  db = await createTestDb();
  deps = createTestServiceDeps(db);
  a = await seedRestaurant(db, "public-menu-a");
  b = await seedRestaurant(db, "public-menu-b");
  publicIdA = await publicIdOf(a.restaurantId);
  publicIdB = await publicIdOf(b.restaurantId);
  const adminA = userCtx(a.restaurantId, a.adminId, "admin");
  const adminB = userCtx(b.restaurantId, b.adminId, "admin");

  await saveMenuItem(deps, adminA, {
    ...meal,
    name: "Executiva Pública",
    popular: true,
    sizes: [
      { name: "P", priceCents: 1500 },
      { name: "G", priceCents: 2200 },
    ],
  });
  await saveMenuItem(deps, adminA, { ...meal, name: "Marmita Indisponível", available: false });
  const archived = await saveMenuItem(deps, adminA, { ...meal, name: "Marmita Arquivada" });
  await archiveMenuItem(deps, adminA, { id: archived.id });
  await saveMenuItem(deps, adminB, { ...meal, name: "Marmita de Outro Restaurante" });
});

afterAll(async () => {
  await db.end();
});

describe("restaurants.public_id", () => {
  test("a new restaurant gets a 12-character hex external id, unique per restaurant", () => {
    expect(publicIdA).toMatch(PUBLIC_ID_PATTERN);
    expect(publicIdB).toMatch(PUBLIC_ID_PATTERN);
    expect(publicIdA).not.toBe(publicIdB);
  });

  test("the external id cannot change", async () => {
    const code = await errorCode(
      () => db`update public.restaurants set public_id = '000000000000' where id = ${a.restaurantId}`,
    );
    expect(code).toBe(RAISE_EXCEPTION);
    expect(await publicIdOf(a.restaurantId)).toBe(publicIdA);
  });
});

describe("getPublicMenu", () => {
  test("returns the restaurant and only its available, unarchived items, without fiscal fields or the internal id", async () => {
    const menu = await getPublicMenu(deps, publicIdA);
    expect(menu).not.toBeNull();
    expect(menu?.restaurantName).toBe("public-menu-a");
    expect(menu?.timezone).toBe("America/Sao_Paulo");

    const names = menu?.items.map((i) => i.name) ?? [];
    expect(names).toContain("Executiva Pública");
    expect(names).not.toContain("Marmita Indisponível");
    expect(names).not.toContain("Marmita Arquivada");
    expect(names).not.toContain("Marmita de Outro Restaurante");

    const item = menu?.items.find((i) => i.name === "Executiva Pública");
    expect(item).toMatchObject({
      kind: "meal",
      category: "proteinas",
      priceCents: 1890,
      popular: true,
      availableWeekdays: [1, 2, 3, 4, 5],
      sizes: [
        { name: "P", priceCents: 1500 },
        { name: "G", priceCents: 2200 },
      ],
    });
    const json = JSON.stringify(menu);
    expect(json).not.toContain("ncm");
    expect(json).not.toContain("cfop");
    expect(json).not.toContain("21069090");
    expect(json).not.toContain(a.restaurantId);
  });

  test("an unknown external id, a malformed one, and the internal id all return null", async () => {
    expect(await getPublicMenu(deps, "ffffffffffff")).toBeNull();
    expect(await getPublicMenu(deps, "abc")).toBeNull();
    expect(await getPublicMenu(deps, a.restaurantId)).toBeNull();
  });
});
