import { describe, expect, test } from "bun:test";

import { clientIpFrom } from "./client-ip";

// covers FR-235
describe("clientIpFrom", () => {
  test("prefers x-real-ip, then the first x-forwarded-for entry", () => {
    expect(clientIpFrom(new Headers({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8" }))).toBe("1.2.3.4");
    expect(clientIpFrom(new Headers({ "x-forwarded-for": " 5.6.7.8 , 10.0.0.1" }))).toBe("5.6.7.8");
  });

  test("is null without a usable header", () => {
    expect(clientIpFrom(new Headers())).toBeNull();
    expect(clientIpFrom(new Headers({ "x-forwarded-for": " " }))).toBeNull();
    expect(clientIpFrom(new Headers({ "x-real-ip": "x".repeat(65) }))).toBeNull();
  });
});
