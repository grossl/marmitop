// covers FR-020, FR-035, FR-037
import { describe, expect, test } from "bun:test";

import { formatCents, formatTime, initials, parseMoneyToCents } from "./orders-format";

describe("orders-format", () => {
  test("formatCents never goes through floats", () => {
    expect(formatCents(0)).toBe("R$ 0,00");
    expect(formatCents(1890)).toBe("R$ 18,90");
    expect(formatCents(123456789)).toBe("R$ 1.234.567,89");
    expect(formatCents(5)).toBe("R$ 0,05");
  });
  test("parseMoneyToCents", () => {
    expect(parseMoneyToCents("50")).toBe(5000);
    expect(parseMoneyToCents("R$ 12,5")).toBe(1250);
    expect(parseMoneyToCents("12.34")).toBe(1234);
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("1,234")).toBeNull();
  });
  test("formatTime uses the restaurant timezone", () => {
    expect(formatTime("2026-10-13T15:00:00Z", "America/Sao_Paulo")).toBe("12:00");
  });
  test("initials", () => {
    expect(initials("Maria da Silva")).toBe("MS");
    expect(initials("")).toBe("?");
  });
});
