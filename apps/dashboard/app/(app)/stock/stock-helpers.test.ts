// covers FR-062, FR-063, FR-066
import { describe, expect, test } from "bun:test";

import { formatMovementDelta, formatQty, parseQty, signedMovementQty } from "./stock-helpers";

describe("stock helpers", () => {
  test("parseQty accepts comma and dot, limits decimals, honours the sign rule", () => {
    expect(parseQty("1,5", { signed: false })).toBe(1.5);
    expect(parseQty("0.125", { signed: false })).toBe(0.125);
    expect(parseQty("0.1234", { signed: false })).toBeNull();
    expect(parseQty("-2", { signed: false })).toBeNull();
    expect(parseQty("-2", { signed: true })).toBe(-2);
    expect(parseQty("abc", { signed: true })).toBeNull();
    expect(parseQty("", { signed: true })).toBeNull();
  });

  test("formatQty uses pt-BR separators", () => {
    expect(formatQty(1.5)).toBe("1,5");
    expect(formatQty(12)).toBe("12");
  });

  test("movement deltas carry their sign", () => {
    expect(signedMovementQty("out", 3)).toBe(-3);
    expect(signedMovementQty("in", 3)).toBe(3);
    expect(signedMovementQty("adjust", -2)).toBe(-2);
    expect(formatMovementDelta("out", 3)).toBe("-3");
    expect(formatMovementDelta("in", 1.5)).toBe("+1,5");
    expect(formatMovementDelta("adjust", -2)).toBe("-2");
  });
});
