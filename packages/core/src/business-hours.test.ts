// covers FR-083, FR-096, FR-113
import { describe, expect, test } from "bun:test";
import { type BusinessHoursRow, isOpenAt, localDay, localParts, nextOpening } from "./business-hours";

const SP = "America/Sao_Paulo";
const row = (weekday: number, opensAt: string, closesAt: string, enabled = true): BusinessHoursRow => ({
  weekday,
  enabled,
  opensAt,
  closesAt,
});
// 2026-10-12 is a Monday. America/Sao_Paulo is UTC-3 all year (no DST since 2019).
const at = (iso: string) => new Date(iso);

describe("isOpenAt: normal day", () => {
  const hours = [row(1, "09:00", "18:00")];
  test("open inside, closed before and after", () => {
    expect(isOpenAt(hours, SP, at("2026-10-12T15:00:00Z"))).toBe(true); // 12:00 local
    expect(isOpenAt(hours, SP, at("2026-10-12T11:00:00Z"))).toBe(false); // 08:00
    expect(isOpenAt(hours, SP, at("2026-10-12T22:00:00Z"))).toBe(false); // 19:00
  });
  test("opening minute is included, closing minute excluded", () => {
    expect(isOpenAt(hours, SP, at("2026-10-12T11:59:59Z"))).toBe(false);
    expect(isOpenAt(hours, SP, at("2026-10-12T12:00:00Z"))).toBe(true);
    expect(isOpenAt(hours, SP, at("2026-10-12T20:59:59Z"))).toBe(true);
    expect(isOpenAt(hours, SP, at("2026-10-12T21:00:00Z"))).toBe(false);
  });
  test("accepts postgres time text with seconds", () => {
    expect(isOpenAt([row(1, "09:00:00", "18:00:00")], SP, at("2026-10-12T12:00:00Z"))).toBe(true);
  });
  test("uses the weekday of the local date, not the UTC date", () => {
    // 2026-10-13T01:00Z is Monday 22:00 in Sao Paulo
    expect(isOpenAt([row(1, "20:00", "23:00")], SP, at("2026-10-13T01:00:00Z"))).toBe(true);
    expect(isOpenAt([row(2, "20:00", "23:00")], SP, at("2026-10-13T01:00:00Z"))).toBe(false);
  });
});

describe("isOpenAt: disabled and missing days", () => {
  test("a disabled weekday is closed", () => {
    expect(isOpenAt([row(1, "09:00", "18:00", false)], SP, at("2026-10-12T15:00:00Z"))).toBe(false);
  });
  test("a day with no row is closed, and no rows at all is closed", () => {
    expect(isOpenAt([row(2, "09:00", "18:00")], SP, at("2026-10-12T15:00:00Z"))).toBe(false);
    expect(isOpenAt([], SP, at("2026-10-12T15:00:00Z"))).toBe(false);
  });
  test("opens_at equal to closes_at is closed (the database forbids it)", () => {
    expect(isOpenAt([row(1, "09:00", "09:00")], SP, at("2026-10-12T15:00:00Z"))).toBe(false);
  });
});

describe("isOpenAt: overnight windows", () => {
  const friday = [row(5, "18:00", "02:00")];
  // 2026-10-16 is a Friday, 2026-10-17 a Saturday
  test("open after opening on the same day and after midnight on the next", () => {
    expect(isOpenAt(friday, SP, at("2026-10-16T21:00:00Z"))).toBe(true); // Fri 18:00
    expect(isOpenAt(friday, SP, at("2026-10-17T02:59:59Z"))).toBe(true); // Fri 23:59
    expect(isOpenAt(friday, SP, at("2026-10-17T03:00:00Z"))).toBe(true); // Sat 00:00
    expect(isOpenAt(friday, SP, at("2026-10-17T04:59:59Z"))).toBe(true); // Sat 01:59:59
  });
  test("closes at the closing time on the next day and is closed before opening", () => {
    expect(isOpenAt(friday, SP, at("2026-10-17T05:00:00Z"))).toBe(false); // Sat 02:00
    expect(isOpenAt(friday, SP, at("2026-10-16T20:59:59Z"))).toBe(false); // Fri 17:59
    expect(isOpenAt(friday, SP, at("2026-10-16T05:00:00Z"))).toBe(false); // Fri 02:00 (Thursday has no window)
  });
  test("the morning side reads the previous day row, so a disabled previous day is closed", () => {
    const hours = [row(5, "18:00", "02:00", false), row(6, "10:00", "14:00")];
    expect(isOpenAt(hours, SP, at("2026-10-17T04:00:00Z"))).toBe(false); // Sat 01:00
  });
  test("today's own normal row and the previous overnight tail do not mix up", () => {
    const hours = [row(5, "18:00", "02:00"), row(6, "10:00", "14:00")];
    expect(isOpenAt(hours, SP, at("2026-10-17T04:00:00Z"))).toBe(true); // Sat 01:00 from Friday
    expect(isOpenAt(hours, SP, at("2026-10-17T08:00:00Z"))).toBe(false); // Sat 05:00
    expect(isOpenAt(hours, SP, at("2026-10-17T13:00:00Z"))).toBe(true); // Sat 10:00
  });
  test("wraps from Saturday (6) into Sunday (0)", () => {
    const hours = [row(6, "22:00", "03:00")];
    expect(isOpenAt(hours, SP, at("2026-10-18T05:00:00Z"))).toBe(true); // Sun 02:00
    expect(isOpenAt(hours, SP, at("2026-10-18T06:00:00Z"))).toBe(false); // Sun 03:00
  });
});

describe("isOpenAt: other timezones and DST", () => {
  test("uses the configured timezone, not Sao Paulo", () => {
    const hours = [row(1, "09:00", "18:00")];
    // Monday 2026-10-12 12:00Z: 09:00 in Sao Paulo, 08:00 in Bogota (UTC-5), 21:00 in Tokyo
    expect(isOpenAt(hours, "America/Bogota", at("2026-10-12T13:00:00Z"))).toBe(false); // 08:00
    expect(isOpenAt(hours, "America/Bogota", at("2026-10-12T14:00:00Z"))).toBe(true); // 09:00
    expect(isOpenAt(hours, "Asia/Tokyo", at("2026-10-12T00:00:00Z"))).toBe(true); // 09:00 JST
  });
  test("follows daylight saving time (New York, spring forward 2026-03-08)", () => {
    const hours = [row(0, "03:30", "06:00")]; // Sunday
    // 06:59Z = 01:59 EST (before the jump); 07:30Z = 03:30 EDT
    expect(isOpenAt(hours, "America/New_York", at("2026-03-08T07:29:00Z"))).toBe(false); // 03:29 EDT
    expect(isOpenAt(hours, "America/New_York", at("2026-03-08T07:30:00Z"))).toBe(true); // 03:30 EDT
    expect(isOpenAt(hours, "America/New_York", at("2026-03-08T09:59:59Z"))).toBe(true); // 05:59 EDT
    expect(isOpenAt(hours, "America/New_York", at("2026-03-08T10:00:00Z"))).toBe(false); // 06:00 EDT
  });
  test("follows daylight saving time (New York, fall back 2026-11-01)", () => {
    const hours = [row(0, "01:30", "03:00")];
    // 05:30Z = 01:30 EDT (first pass); 06:30Z = 01:30 EST (second pass); 08:00Z = 03:00 EST
    expect(isOpenAt(hours, "America/New_York", at("2026-11-01T05:30:00Z"))).toBe(true);
    expect(isOpenAt(hours, "America/New_York", at("2026-11-01T07:59:59Z"))).toBe(true);
    expect(isOpenAt(hours, "America/New_York", at("2026-11-01T08:00:00Z"))).toBe(false);
  });
  test("rejects an unknown timezone", () => {
    expect(() => isOpenAt([], "Mars/Olympus", at("2026-10-12T15:00:00Z"))).toThrow();
  });
});

describe("localParts / localDay", () => {
  test("breaks an instant into local wall-clock parts", () => {
    expect(localParts(at("2026-10-13T01:30:15Z"), SP)).toEqual({
      year: 2026,
      month: 10,
      day: 12,
      hour: 22,
      minute: 30,
      second: 15,
      weekday: 1,
    });
    expect(localDay(at("2026-10-13T01:30:15Z"), SP)).toBe("2026-10-12");
    expect(localDay(at("2026-10-13T03:00:00Z"), SP)).toBe("2026-10-13");
  });
});

describe("nextOpening", () => {
  const hours = [row(1, "09:00", "18:00"), row(3, "09:00", "18:00")];
  test("returns the start of the next window as an instant", () => {
    // Monday 19:00 local -> Wednesday 09:00 local = 12:00Z
    expect(nextOpening(hours, SP, at("2026-10-12T22:00:00Z"))?.toISOString()).toBe("2026-10-14T12:00:00.000Z");
  });
  test("before opening on an open day returns today", () => {
    expect(nextOpening(hours, SP, at("2026-10-12T10:00:00Z"))?.toISOString()).toBe("2026-10-12T12:00:00.000Z");
  });
  test("while open, returns the next window start after now", () => {
    expect(nextOpening(hours, SP, at("2026-10-12T15:00:00Z"))?.toISOString()).toBe("2026-10-14T12:00:00.000Z");
  });
  test("null when the restaurant never opens", () => {
    expect(nextOpening([row(1, "09:00", "18:00", false)], SP, at("2026-10-12T15:00:00Z"))).toBeNull();
    expect(nextOpening([], SP, at("2026-10-12T15:00:00Z"))).toBeNull();
  });
  test("handles a DST zone", () => {
    // New York, Saturday 2026-03-07 12:00Z; opens Sunday 03:30 which exists after the jump (EDT, 07:30Z)
    const h = [row(0, "03:30", "06:00")];
    expect(nextOpening(h, "America/New_York", at("2026-03-07T12:00:00Z"))?.toISOString()).toBe(
      "2026-03-08T07:30:00.000Z",
    );
  });
});
