// covers FR-050, FR-051, FR-052, FR-058
import { describe, expect, test } from "bun:test";

import { centsToInput, formatBRL, headlinePriceCents, menuImagePath, reaisToCents } from "./menu-helpers";

describe("menu helpers", () => {
  test("formatBRL formats cents", () => {
    expect(formatBRL(1890)).toBe("R$ 18,90");
    expect(formatBRL(5)).toBe("R$ 0,05");
    expect(formatBRL(123456789)).toBe("R$ 1.234.567,89");
  });

  test("reaisToCents accepts comma and dot and rejects junk", () => {
    expect(reaisToCents("18,90")).toBe(1890);
    expect(reaisToCents("18.9")).toBe(1890);
    expect(reaisToCents("18")).toBe(1800);
    expect(reaisToCents("-1")).toBeNull();
    expect(reaisToCents("1,234")).toBeNull();
    expect(reaisToCents("")).toBeNull();
  });

  test("centsToInput", () => {
    expect(centsToInput(1850)).toBe("18.50");
  });

  test("headline price is the lowest size, else the base price", () => {
    expect(headlinePriceCents({ priceCents: 2000, sizes: [] })).toBe(2000);
    expect(headlinePriceCents({ priceCents: 2000, sizes: [{ priceCents: 2500 }, { priceCents: 1800 }] })).toBe(1800);
  });

  test("image path is scoped by restaurant and refuses other types", () => {
    expect(menuImagePath("r", "m", "f", "image/webp")).toBe("r/menu/m/f.webp");
    expect(menuImagePath("r", "m", "f", "image/gif")).toBeNull();
  });
});
