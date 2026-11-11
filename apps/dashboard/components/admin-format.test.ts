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
  publicUrlReasonText,
  uatisModeExplanation,
  uatisModeLabel,
  uatisNextModeText,
  uatisPullInProduction,
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

// covers FR-172, FR-178 (ADR-021, ADR-023, ADR-041): the WhatsApp webhook panel text.
describe("uatis webhook text", () => {
  test("mode labels and explanations", () => {
    expect(uatisModeLabel("push")).toBe("Push");
    expect(uatisModeLabel("pull")).toBe("Pull");
    expect(uatisModeExplanation("push")).toContain("envia cada evento");
    expect(uatisModeExplanation("pull")).toContain("sem URL pública");
  });

  test("the next mode says why", () => {
    expect(
      uatisNextModeText({ nextMode: "push", publicUrl: { ok: true, url: "https://api.example.com", reason: null } }),
    ).toBe("Ao ativar, o modo será Push: MT_PUBLIC_URL (https://api.example.com) é uma URL pública https.");
    expect(
      uatisNextModeText({
        nextMode: "pull",
        publicUrl: { ok: false, url: "http://localhost:3101", reason: "not_https" },
      }),
    ).toBe("Ao ativar, o modo será Pull: MT_PUBLIC_URL (http://localhost:3101) não usa https.");
    expect(uatisNextModeText({ nextMode: "pull", publicUrl: { ok: false, url: null, reason: "missing" } })).toBe(
      "Ao ativar, o modo será Pull: MT_PUBLIC_URL não está definida.",
    );
  });

  test("production never announces pull (ADR-041)", () => {
    expect(
      uatisNextModeText({
        nextMode: "pull",
        pushRequired: true,
        publicUrl: { ok: false, url: null, reason: "missing" },
      }),
    ).toBe("Em produção o modo Pull não é permitido: MT_PUBLIC_URL não está definida.");
    expect(
      uatisNextModeText({
        nextMode: "push",
        pushRequired: true,
        publicUrl: { ok: true, url: "https://api.example.com", reason: null },
      }),
    ).toBe("Ao ativar, o modo será Push: MT_PUBLIC_URL (https://api.example.com) é uma URL pública https.");
  });

  test("a pull webhook is flagged in production only (ADR-041)", () => {
    expect(uatisPullInProduction({ state: "active", mode: "pull", pushRequired: true })).toBe(true);
    expect(uatisPullInProduction({ state: "active", mode: "pull", pushRequired: false })).toBe(false);
    expect(uatisPullInProduction({ state: "active", mode: "push", pushRequired: true })).toBe(false);
    expect(uatisPullInProduction({ state: "not_registered", mode: null, pushRequired: true })).toBe(false);
  });

  test("every public URL reason has pt-BR text", () => {
    for (const reason of [
      "missing",
      "invalid_url",
      "not_https",
      "userinfo_not_allowed",
      "port_not_allowed",
      "query_not_allowed",
      "private_host",
    ] as const) {
      expect(publicUrlReasonText(reason).length).toBeGreaterThan(5);
    }
  });
});
