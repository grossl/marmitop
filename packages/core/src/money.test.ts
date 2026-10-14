// covers FR-037, FR-120, NFR-041
import { describe, expect, test } from "bun:test";
import { assertCents, centsToReais, formatBRL } from "./money";

describe("centsToReais", () => {
  test("converts without float drift", () => {
    expect(centsToReais(0)).toBe(0);
    expect(centsToReais(1)).toBe(0.01);
    expect(centsToReais(10)).toBe(0.1);
    expect(centsToReais(99)).toBe(0.99);
    expect(centsToReais(100)).toBe(1);
    expect(centsToReais(1999)).toBe(19.99);
    expect(centsToReais(123456)).toBe(1234.56);
    expect(centsToReais(1_000_000_001n)).toBe(10000000.01);
  });

  test("has exactly two decimals in the JSON text for every cent value 0..20000", () => {
    for (let c = 0; c <= 20000; c++) {
      const text = JSON.stringify(centsToReais(c));
      const expected = (c / 100).toFixed(2).replace(/\.?0+$/, "");
      expect(text).toBe(expected === "" ? "0" : expected);
    }
  });

  test("rejects negative and non-integer cents", () => {
    expect(() => centsToReais(-1)).toThrow();
    expect(() => centsToReais(1.5)).toThrow();
    expect(() => centsToReais(Number.NaN)).toThrow();
  });
});

describe("assertCents / formatBRL", () => {
  test("assertCents accepts safe integers only", () => {
    expect(assertCents(5, "x")).toBe(5);
    expect(() => assertCents(5.5, "x")).toThrow();
    expect(() => assertCents(2 ** 60, "x")).toThrow();
  });
  test("formatBRL uses pt-BR grouping", () => {
    expect(formatBRL(123456)).toBe("R$ 1.234,56");
  });
});
