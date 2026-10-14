// covers FR-005, FR-007, FR-169
import { describe, expect, test } from "bun:test";

import { canOpen, NAV_ITEMS, navItemsFor, sectionForPath } from "./nav";

describe("navigation by role", () => {
  test("an attendant sees messages, orders, new order, and contacts only", () => {
    expect(navItemsFor("attendant").map((i): string => i.id).sort()).toEqual(
      ["contacts", "messages", "new-order", "orders"].sort(),
    );
  });

  test("an admin sees every screen", () => {
    expect(navItemsFor("admin").length).toBe(NAV_ITEMS.length);
    expect(NAV_ITEMS.length).toBe(9);
  });

  test("canOpen refuses admin-only screens to an attendant", () => {
    for (const id of ["menu", "stock", "reports", "finance", "settings"] as const) {
      expect(canOpen("attendant", id)).toBe(false);
      expect(canOpen("admin", id)).toBe(true);
    }
  });

  test("every item routes to /<id>", () => {
    for (const item of NAV_ITEMS) expect(item.href).toBe(`/${item.id}`);
  });

  test("sectionForPath matches nested paths and ignores unknown ones", () => {
    expect(sectionForPath("/orders")).toBe("orders");
    expect(sectionForPath("/orders/123")).toBe("orders");
    expect(sectionForPath("/login")).toBeUndefined();
  });
});
