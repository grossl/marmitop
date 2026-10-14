import { describe, expect, test } from "bun:test";
import type { Clock } from "../ports/clock";

export function clockContract(name: string, create: () => Clock): void {
  describe(`Clock contract: ${name}`, () => {
    test("now returns a valid Date", () => {
      const d = create().now();
      expect(d).toBeInstanceOf(Date);
      expect(Number.isNaN(d.getTime())).toBe(false);
    });
    test("mutating the returned Date does not change the clock", () => {
      const clock = create();
      const before = clock.now().getTime();
      clock.now().setFullYear(1999);
      expect(Math.abs(clock.now().getTime() - before)).toBeLessThan(5000);
    });
  });
}
