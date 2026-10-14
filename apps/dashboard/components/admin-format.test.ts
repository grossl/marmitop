// covers FR-070, FR-082, FR-154
import { describe, expect, test } from "bun:test";

import {
  addDays,
  canRedeliver,
  centsToInput,
  deliveryStatusLabel,
  formatBRL,
  formatDayLabel,
  formatMonthLabel,
  parseBRLToCents,
  usagePercent,
} from "./admin-format";

describe("admin-format", () => {
  test("formats cents as BRL", () => {
    expect(formatBRL(123456).replace(/\s/g, " ")).toBe("R$ 1.234,56");
  });

  test("parses money text to integer cents", () => {
    expect(parseBRLToCents("6,50")).toBe(650);
    expect(parseBRLToCents("6.5")).toBe(650);
    expect(parseBRLToCents("R$ 1.234,56")).toBe(123456);
    expect(parseBRLToCents("0")).toBe(0);
    expect(parseBRLToCents("")).toBeNull();
    expect(parseBRLToCents("abc")).toBeNull();
    expect(parseBRLToCents("-3")).toBeNull();
    expect(parseBRLToCents("1,234")).toBeNull();
  });

  test("renders cents for an input", () => {
    expect(centsToInput(650)).toBe("6,50");
    expect(centsToInput(0)).toBe("0,00");
  });

  test("labels months and days", () => {
    expect(formatMonthLabel("2026-10")).toBe("out/26");
    expect(formatDayLabel("2026-10-13")).toBe("13/10");
  });

  test("adds days across month ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  test("usage percent is capped and safe for a zero limit", () => {
    expect(usagePercent(150, 300)).toBe(50);
    expect(usagePercent(400, 300)).toBe(100);
    expect(usagePercent(5, 0)).toBe(0);
  });
});

// covers FR-149
describe("webhook deliveries", () => {
  test("labels each delivery status in pt-BR", () => {
    expect(deliveryStatusLabel("pending")).toBe("Pendente");
    expect(deliveryStatusLabel("delivered")).toBe("Entregue");
    expect(deliveryStatusLabel("failed")).toBe("Nova tentativa agendada");
    expect(deliveryStatusLabel("exhausted")).toBe("Esgotada");
  });

  test("only delivered and exhausted deliveries can be sent again", () => {
    expect(canRedeliver("delivered")).toBe(true);
    expect(canRedeliver("exhausted")).toBe(true);
    expect(canRedeliver("pending")).toBe(false);
    expect(canRedeliver("failed")).toBe(false);
  });
});
