// covers FR-010, FR-042, NFR-040
import { describe, expect, test } from "bun:test";

import { addressLine, formatBRL, formatDate, formatListTime, formatTime, initials } from "./messaging-format";

describe("messaging-format", () => {
  test("money is BRL from cents", () => {
    expect(formatBRL(123456).replace(/\s/g, " ")).toBe("R$ 1.234,56");
    expect(formatBRL(0).replace(/\s/g, " ")).toBe("R$ 0,00");
  });
  test("times use 24 hours in São Paulo, dates dd/mm/aaaa", () => {
    expect(formatTime("2026-10-13T15:05:00Z")).toBe("12:05");
    expect(formatDate("2026-10-13T15:05:00Z")).toBe("13/10/2026");
  });
  test("list time: today shows the hour, yesterday a word, older the date", () => {
    const now = new Date("2026-10-13T15:00:00Z");
    expect(formatListTime("2026-10-13T12:00:00Z", now)).toBe("09:00");
    expect(formatListTime("2026-10-12T15:00:00Z", now)).toBe("Ontem");
    expect(formatListTime("2026-10-01T15:00:00Z", now)).toBe("01/10/2026");
    expect(formatListTime(null, now)).toBe("");
  });
  test("initials", () => {
    expect(initials("Maria da Silva")).toBe("MS");
    expect(initials("joana")).toBe("J");
    expect(initials("")).toBe("?");
  });
  test("one-line address skips empty parts", () => {
    expect(
      addressLine({ logradouro: "Rua A", numero: "10", complemento: null, bairro: "Centro", cidade: "Rio", uf: "RJ" }),
    ).toBe("Rua A, 10 — Centro, Rio/RJ");
    expect(
      addressLine({ logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null }),
    ).toBe("");
  });
});
