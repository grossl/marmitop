// covers FR-164, FR-167, FR-168
import { describe, expect, test } from "bun:test";

import { canIssueRow, countBatch, formatRange, pluralOrders } from "./finance-format";

describe("finance display helpers", () => {
  test("Emitir NF shows for an invoiceable order without a live invoice", () => {
    expect(canIssueRow({ status: "finalizado", invoice: null })).toBe(true);
    expect(canIssueRow({ status: "finalizado", invoice: { status: "rejected" } })).toBe(true);
    expect(canIssueRow({ status: "finalizado", invoice: { status: "cancelled" } })).toBe(true);
    expect(canIssueRow({ status: "finalizado", invoice: { status: "authorized" } })).toBe(false);
    expect(canIssueRow({ status: "saiu", invoice: { status: "processing" } })).toBe(false);
    // Pix paid in advance, still in the kitchen (FR-121).
    expect(canIssueRow({ status: "confirmado", invoice: null })).toBe(false);
  });

  test("batch counts by outcome", () => {
    expect(
      countBatch([{ outcome: "issued" }, { outcome: "blocked" }, { outcome: "issued" }, { outcome: "skipped" }]),
    ).toEqual({
      issued: 2,
      blocked: 1,
      skipped: 1,
    });
  });

  test("range and plural labels", () => {
    expect(formatRange("2026-10-01", "2026-10-31")).toBe("01/10 a 31/10/2026");
    expect(formatRange("2025-12-01", "2026-01-31")).toBe("01/12/2025 a 31/01/2026");
    expect(pluralOrders(0)).toBe("Nenhum pedido");
    expect(pluralOrders(1)).toBe("1 pedido");
    expect(pluralOrders(12)).toBe("12 pedidos");
  });
});
