// covers FR-010, FR-011, FR-041
import { describe, expect, test } from "bun:test";

import { decodeCursor, encodeCursor, escapeLike, likePattern, previewOf } from "./helpers";

describe("previewOf", () => {
  test("collapses whitespace and keeps short text", () => {
    expect(previewOf("  Oi,\n  tudo bem?  ")).toBe("Oi, tudo bem?");
  });
  test("cuts to 120 characters", () => {
    expect(previewOf("a".repeat(300))).toHaveLength(120);
    expect(previewOf("a".repeat(120))).toHaveLength(120);
  });
});

describe("search patterns", () => {
  test("wildcards match literally", () => {
    expect(escapeLike("100%_a\\b")).toBe("100\\%\\_a\\\\b");
    expect(likePattern(" maria ")).toBe("%maria%");
    expect(likePattern("   ")).toBeNull();
    expect(likePattern(undefined)).toBeNull();
  });
});

describe("cursor", () => {
  test("round trips and falls back to the first page", () => {
    expect(decodeCursor(encodeCursor(50))).toBe(50);
    expect(decodeCursor(undefined)).toBe(0);
    expect(decodeCursor("garbage")).toBe(0);
  });
});
