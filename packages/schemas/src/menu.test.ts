// covers FR-051, FR-052, FR-053, FR-054, FR-055, FR-056, FR-058
import { describe, expect, test } from "bun:test";
import {
  DRINK_CATEGORIES,
  deleteMenuItemSchema,
  listMenuQuerySchema,
  MEAL_CATEGORIES,
  saveMenuItemSchema,
  setMenuItemAvailabilitySchema,
} from "./menu";

const meal = {
  kind: "meal",
  name: "Marmita Fit",
  description: "Frango grelhado",
  category: "fit",
  priceCents: 2500,
  calories: 480,
  available: true,
  popular: false,
  availableWeekdays: [1, 2, 3, 4, 5],
  sizes: [
    { name: "P", priceCents: 2200 },
    { name: "G", priceCents: 3200 },
  ],
};
const drink = {
  kind: "drink",
  name: "Suco",
  category: "sucos",
  priceCents: 799,
  volume: "350ml",
  available: true,
  popular: true,
  availableWeekdays: [0, 1, 2, 3, 4, 5, 6],
  sizes: [],
};

describe("saveMenuItemSchema", () => {
  test("categories match the data model", () => {
    expect([...MEAL_CATEGORIES]).toEqual(["proteinas", "vegetariano", "fit", "executiva", "especial"]);
    expect([...DRINK_CATEGORIES]).toEqual(["refrigerantes", "sucos", "agua", "alcoolicas", "quentes"]);
  });
  test("accepts a meal with sizes and a drink", () => {
    expect(saveMenuItemSchema.safeParse(meal).success).toBe(true);
    expect(saveMenuItemSchema.safeParse(drink).success).toBe(true);
  });
  test("name and price are required (FR-051)", () => {
    expect(saveMenuItemSchema.safeParse({ ...meal, name: "" }).success).toBe(false);
    const { priceCents, ...noPrice } = meal;
    expect(saveMenuItemSchema.safeParse(noPrice).success).toBe(false);
    expect(saveMenuItemSchema.safeParse({ ...meal, priceCents: -1 }).success).toBe(false);
    expect(saveMenuItemSchema.safeParse({ ...meal, priceCents: 10.5 }).success).toBe(false);
  });
  test("category must fit the kind", () => {
    expect(saveMenuItemSchema.safeParse({ ...meal, category: "sucos" }).success).toBe(false);
    expect(saveMenuItemSchema.safeParse({ ...drink, category: "fit" }).success).toBe(false);
  });
  test("calories only on meals, volume only on drinks", () => {
    expect(saveMenuItemSchema.safeParse({ ...drink, calories: 100 }).success).toBe(false);
    expect(saveMenuItemSchema.safeParse({ ...meal, volume: "350ml" }).success).toBe(false);
  });
  test("weekdays are 0..6 and unique (FR-054)", () => {
    expect(saveMenuItemSchema.safeParse({ ...meal, availableWeekdays: [7] }).success).toBe(false);
    expect(saveMenuItemSchema.safeParse({ ...meal, availableWeekdays: [1, 1] }).success).toBe(false);
    expect(saveMenuItemSchema.parse({ ...meal, availableWeekdays: [5, 1, 3] }).availableWeekdays).toEqual([1, 3, 5]);
  });
  test("sizes: unique names, non-negative prices, at most 10 (FR-052)", () => {
    expect(
      saveMenuItemSchema.safeParse({
        ...meal,
        sizes: [
          { name: "G", priceCents: 1 },
          { name: "g", priceCents: 2 },
        ],
      }).success,
    ).toBe(false);
    expect(saveMenuItemSchema.safeParse({ ...meal, sizes: [{ name: "G", priceCents: -1 }] }).success).toBe(false);
    expect(
      saveMenuItemSchema.safeParse({
        ...meal,
        sizes: Array.from({ length: 11 }, (_, i) => ({ name: `S${i}`, priceCents: 1 })),
      }).success,
    ).toBe(false);
  });
  test("fiscal overrides: NCM 8 digits and CFOP 4 digits (FR-058)", () => {
    expect(saveMenuItemSchema.parse({ ...meal, ncm: "21069090", cfop: "5101" })).toMatchObject({
      ncm: "21069090",
      cfop: "5101",
    });
    expect(saveMenuItemSchema.safeParse({ ...meal, ncm: "2106" }).success).toBe(false);
    expect(saveMenuItemSchema.safeParse({ ...meal, cfop: "51011" }).success).toBe(false);
    expect(saveMenuItemSchema.parse({ ...meal, ncm: "", cfop: null }).ncm).toBeNull();
  });
  test("image url and description length", () => {
    expect(saveMenuItemSchema.safeParse({ ...meal, imageUrl: "not a url" }).success).toBe(false);
    expect(saveMenuItemSchema.safeParse({ ...meal, imageUrl: "https://cdn.example.com/a.png" }).success).toBe(true);
    expect(saveMenuItemSchema.safeParse({ ...meal, description: "x".repeat(501) }).success).toBe(false);
  });
  test("id is optional (update)", () => {
    expect(saveMenuItemSchema.safeParse({ ...meal, id: "3f6c1a0e-7a3b-4b1e-9c53-1f3f6d0f6a11" }).success).toBe(true);
  });
});

describe("other menu inputs", () => {
  test("availability and delete take a uuid", () => {
    const id = "3f6c1a0e-7a3b-4b1e-9c53-1f3f6d0f6a11";
    expect(setMenuItemAvailabilitySchema.safeParse({ id, available: false }).success).toBe(true);
    expect(deleteMenuItemSchema.safeParse({ id }).success).toBe(true);
    expect(deleteMenuItemSchema.safeParse({ id: "x" }).success).toBe(false);
  });
  test("listMenuQuerySchema (06): kind, available, weekday", () => {
    expect(listMenuQuerySchema.parse({ kind: "meal", available: "true", weekday: "2" })).toMatchObject({
      kind: "meal",
      available: true,
      weekday: 2,
      limit: 50,
    });
    expect(listMenuQuerySchema.parse({ available: "false" }).available).toBe(false);
    expect(listMenuQuerySchema.safeParse({ weekday: "7" }).success).toBe(false);
    expect(listMenuQuerySchema.safeParse({ kind: "snack" }).success).toBe(false);
  });
});
