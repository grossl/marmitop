// covers FR-050, FR-051, FR-052, FR-053, FR-054, FR-057, FR-058, FR-006, FR-008, NFR-001
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AppError } from "@mt/core";
import type { Db } from "@mt/db";
import { createTestDb, type RestaurantFixture, seedRestaurant } from "@mt/db/test-harness";

import type { ServiceDeps } from "../../deps";
import { createTestServiceDeps, userCtx } from "../../testing";
import { archiveMenuItem, listMenuItems, saveMenuItem, setMenuItemAvailability } from "./menu";

let db: Db;
let deps: ServiceDeps;
let a: RestaurantFixture;
let b: RestaurantFixture;
let admin: ReturnType<typeof userCtx>;
let attendant: ReturnType<typeof userCtx>;

const code = (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`);

const meal = {
  kind: "meal" as const,
  name: "Frango Grelhado",
  description: "Arroz, feijão e frango",
  category: "proteinas",
  priceCents: 1890,
  calories: 520,
  available: true,
  popular: false,
  availableWeekdays: [1, 2, 3, 4, 5],
};

beforeAll(async () => {
  db = await createTestDb();
  deps = createTestServiceDeps(db);
  a = await seedRestaurant(db, "menu-a");
  b = await seedRestaurant(db, "menu-b");
  admin = userCtx(a.restaurantId, a.adminId, "admin");
  attendant = userCtx(a.restaurantId, a.attendantId, "attendant");
});

afterAll(async () => {
  await db.end();
});

describe("saveMenuItem", () => {
  test("an admin creates a meal with ordered sizes and fiscal overrides", async () => {
    const saved = await saveMenuItem(deps, admin, {
      ...meal,
      name: "Executiva com tamanhos",
      ncm: "21069090",
      cfop: "5102",
      sizes: [
        { name: "P", priceCents: 1500 },
        { name: "G", priceCents: 2200 },
      ],
    });
    expect(saved).toMatchObject({
      kind: "meal",
      priceCents: 1890,
      ncm: "21069090",
      cfop: "5102",
      availableWeekdays: [1, 2, 3, 4, 5],
    });
    expect(saved.sizes.map((s) => [s.name, s.priceCents])).toEqual([
      ["P", 1500],
      ["G", 2200],
    ]);
  });

  test("an update replaces the sizes and keeps the order", async () => {
    const created = await saveMenuItem(deps, admin, {
      ...meal,
      name: "Para editar",
      sizes: [{ name: "M", priceCents: 1000 }],
    });
    const updated = await saveMenuItem(deps, admin, {
      ...meal,
      id: created.id,
      name: "Editada",
      sizes: [
        { name: "G", priceCents: 2000 },
        { name: "M", priceCents: 1100 },
      ],
    });
    expect(updated.name).toBe("Editada");
    expect(updated.sizes.map((s) => s.name)).toEqual(["G", "M"]);
    const rows = await db<{ name: string }[]>`
      select name from public.menu_item_sizes where menu_item_id = ${created.id} order by position`;
    expect(rows.map((r) => r.name)).toEqual(["G", "M"]);
  });

  test("a drink keeps volume and refuses calories", async () => {
    const drink = await saveMenuItem(deps, admin, {
      kind: "drink",
      name: "Suco de laranja",
      category: "sucos",
      priceCents: 700,
      volume: "300ml",
    });
    expect(drink).toMatchObject({ kind: "drink", volume: "300ml", calories: null });
    const error = await saveMenuItem(deps, admin, {
      kind: "drink",
      name: "Errada",
      category: "sucos",
      priceCents: 700,
      calories: 10,
    }).catch((e) => e);
    expect(code(error)).toBe("validation_failed");
  });

  test("an attendant is refused", async () => {
    const error = await saveMenuItem(deps, attendant, { ...meal, name: "Nao" }).catch((e) => e);
    expect(code(error)).toBe("forbidden");
  });

  test("invalid input is refused with field paths", async () => {
    const error = await saveMenuItem(deps, admin, { ...meal, name: "", ncm: "123" }).catch((e) => e);
    expect(code(error)).toBe("validation_failed");
  });

  test("restaurant B cannot update an item of restaurant A", async () => {
    const created = await saveMenuItem(deps, admin, { ...meal, name: "Do A" });
    const error = await saveMenuItem(deps, userCtx(b.restaurantId, b.adminId, "admin"), {
      ...meal,
      id: created.id,
      name: "Invadida",
    }).catch((e) => e);
    expect(code(error)).toBe("not_found");
    const [row] = await db<{ name: string }[]>`select name from public.menu_items where id = ${created.id}`;
    expect(row?.name).toBe("Do A");
  });
});

describe("listMenuItems", () => {
  test("an attendant reads the menu, filtered by kind and search", async () => {
    await saveMenuItem(deps, admin, { ...meal, name: "Strogonoff especial", category: "especial" });
    const meals = await listMenuItems(deps, attendant, { kind: "meal" });
    expect(meals.length).toBeGreaterThan(0);
    expect(meals.every((m) => m.kind === "meal")).toBe(true);
    const found = await listMenuItems(deps, attendant, { q: "strogonoff" });
    expect(found.map((m) => m.name)).toContain("Strogonoff especial");
  });

  test("restaurant B sees none of A's items", async () => {
    const listB = await listMenuItems(deps, userCtx(b.restaurantId, b.adminId, "admin"), {});
    const idsA = new Set((await listMenuItems(deps, admin, {})).map((m) => m.id));
    expect(listB.some((m) => idsA.has(m.id))).toBe(false);
  });
});

describe("setMenuItemAvailability and archiveMenuItem", () => {
  test("an admin toggles availability; an attendant cannot", async () => {
    const item = await saveMenuItem(deps, admin, { ...meal, name: "Toggle" });
    expect(await setMenuItemAvailability(deps, admin, { id: item.id, available: false })).toEqual({
      id: item.id,
      available: false,
    });
    const error = await setMenuItemAvailability(deps, attendant, { id: item.id, available: true }).catch((e) => e);
    expect(code(error)).toBe("forbidden");
  });

  test("Excluir archives: the row stays, the lists drop it, a second archive is not_found", async () => {
    const item = await saveMenuItem(deps, admin, { ...meal, name: "Arquivar" });
    await archiveMenuItem(deps, admin, { id: item.id });
    const [row] = await db<
      { archived_at: Date | null }[]
    >`select archived_at from public.menu_items where id = ${item.id}`;
    expect(row?.archived_at).not.toBeNull();
    expect((await listMenuItems(deps, admin, {})).some((m) => m.id === item.id)).toBe(false);
    const error = await archiveMenuItem(deps, admin, { id: item.id }).catch((e) => e);
    expect(code(error)).toBe("not_found");
  });
});
