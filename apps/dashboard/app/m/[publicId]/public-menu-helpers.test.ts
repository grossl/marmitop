// covers FR-223, FR-238
import { describe, expect, test } from "bun:test";
import type { PublicMenuItemDto } from "@mt/http";

import {
  groupByCategory,
  isOfferedOn,
  startingPriceCents,
  weekdaysText,
  whatsappLink,
  whatsappOrderLink,
} from "./public-menu-helpers";

function item(overrides: Partial<PublicMenuItemDto>): PublicMenuItemDto {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "meal",
    name: "Frango",
    description: null,
    category: "proteinas",
    priceCents: 1890,
    calories: null,
    volume: null,
    popular: false,
    availableWeekdays: [0, 1, 2, 3, 4, 5, 6],
    imageUrl: null,
    sizes: [],
    ...overrides,
  };
}

describe("groupByCategory", () => {
  test("keeps one kind and orders the sections as the menu screen does", () => {
    const sections = groupByCategory(
      [
        item({ name: "Fit", category: "fit" }),
        item({ name: "Frango", category: "proteinas" }),
        item({ name: "Suco", kind: "drink", category: "sucos" }),
        item({ name: "Carne", category: "proteinas" }),
      ],
      "meal",
    );
    expect(sections.map((s) => s.label)).toEqual(["Proteínas", "Fit & Saudável"]);
    expect(sections[0]?.items.map((i) => i.name)).toEqual(["Frango", "Carne"]);
  });

  test("drinks use the drink labels", () => {
    const sections = groupByCategory([item({ kind: "drink", category: "agua" })], "drink");
    expect(sections).toMatchObject([{ category: "agua", label: "Água" }]);
  });
});

describe("weekdays", () => {
  test("an item is offered today only on its weekdays", () => {
    const weekdaysOnly = item({ availableWeekdays: [1, 2, 3, 4, 5] });
    expect(isOfferedOn(weekdaysOnly, 2)).toBe(true);
    expect(isOfferedOn(weekdaysOnly, 0)).toBe(false);
  });

  test("weekdaysText lists Monday first, or says every day", () => {
    expect(weekdaysText([0, 1, 2, 3, 4, 5, 6])).toBe("Todos os dias");
    expect(weekdaysText([0, 5, 1])).toBe("Seg, Sex, Dom");
  });
});

describe("startingPriceCents", () => {
  test("the base price without sizes, the smallest size with sizes", () => {
    expect(startingPriceCents(item({}))).toBe(1890);
    expect(
      startingPriceCents(
        item({
          sizes: [
            { id: "g", name: "G", priceCents: 2200 },
            { id: "p", name: "P", priceCents: 1500 },
          ],
        }),
      ),
    ).toBe(1500);
  });
});

describe("whatsappLink", () => {
  test("adds the country code to a Brazilian number", () => {
    expect(whatsappLink("(11) 99999-0000")).toBe("https://wa.me/5511999990000");
    expect(whatsappLink("(31) 3333-1111")).toBe("https://wa.me/553133331111");
  });

  test("keeps a number that already has the country code", () => {
    expect(whatsappLink("+55 11 99999-0000")).toBe("https://wa.me/5511999990000");
  });

  test("returns null without a dialable phone", () => {
    expect(whatsappLink(null)).toBeNull();
    expect(whatsappLink("1234")).toBeNull();
  });
});

describe("whatsappOrderLink", () => {
  test("puts the encoded order text in the chat link", () => {
    expect(whatsappOrderLink("(11) 99999-0000", "*Pedido ORD-1*\n2x Frango & arroz")).toBe(
      "https://wa.me/5511999990000?text=*Pedido%20ORD-1*%0A2x%20Frango%20%26%20arroz",
    );
  });

  test("returns null without a dialable phone", () => {
    expect(whatsappOrderLink(null, "oi")).toBeNull();
  });
});
