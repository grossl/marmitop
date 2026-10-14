// covers FR-117, FR-112
import { describe, expect, test } from "bun:test";
import { AppError } from "./errors";
import { assertFreeTextAllowed, decideServiceWindow, isWithinServiceWindow } from "./service-window";

const now = new Date("2026-10-13T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const template = { name: "order_update", language: "pt_BR" };

describe("decideServiceWindow (ADR-014)", () => {
  test("inside the window: free text", () => {
    expect(decideServiceWindow({ lastInboundAt: hoursAgo(1), now, template })).toEqual({ mode: "text" });
    expect(decideServiceWindow({ lastInboundAt: hoursAgo(1), now, template: null })).toEqual({ mode: "text" });
  });
  test("exactly 24 hours old is still inside; older is outside", () => {
    expect(isWithinServiceWindow(hoursAgo(24), now)).toBe(true);
    expect(isWithinServiceWindow(new Date(hoursAgo(24).getTime() - 1), now)).toBe(false);
  });
  test("outside with a configured template: the template", () => {
    expect(decideServiceWindow({ lastInboundAt: hoursAgo(30), now, template })).toEqual({
      mode: "template",
      templateName: "order_update",
      templateLanguage: "pt_BR",
    });
  });
  test("outside without a template: blocked with outside_service_window", () => {
    expect(decideServiceWindow({ lastInboundAt: hoursAgo(30), now, template: null })).toEqual({
      mode: "blocked",
      errorCode: "outside_service_window",
    });
  });
  test("no inbound message ever counts as outside", () => {
    expect(decideServiceWindow({ lastInboundAt: null, now, template: null }).mode).toBe("blocked");
    expect(decideServiceWindow({ lastInboundAt: null, now, template }).mode).toBe("template");
  });
  test("a last-inbound time slightly in the future (clock skew) is inside", () => {
    expect(isWithinServiceWindow(new Date(now.getTime() + 5000), now)).toBe(true);
  });
});

describe("assertFreeTextAllowed (manual reply)", () => {
  test("passes inside the window", () => {
    expect(() => assertFreeTextAllowed(hoursAgo(2), now)).not.toThrow();
  });
  test("throws 422 outside_service_window outside it", () => {
    try {
      assertFreeTextAllowed(hoursAgo(25), now);
      throw new Error("no throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("outside_service_window");
      expect((e as AppError).httpStatus).toBe(422);
    }
    expect(() => assertFreeTextAllowed(null, now)).toThrow();
  });
});
