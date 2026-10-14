// covers FR-021, FR-022, FR-023, FR-026, FR-028, FR-029
import { describe, expect, test } from "bun:test";
import {
  allowedTargets,
  applyTransition,
  canTransition,
  type Fulfillment,
  initialStatus,
  isFinalStatus,
  ORDER_STATUSES,
  type OrderStatus,
} from "./order-status";

// The table from 05.data-model.md "Order status transitions" (ADR-017), written out by hand.
const DELIVERY: Record<OrderStatus, OrderStatus[]> = {
  aguardando: ["confirmado", "preparando", "pronto", "saiu", "entregue", "cancelado"],
  confirmado: ["preparando", "pronto", "saiu", "entregue", "aguardando", "cancelado"],
  preparando: ["pronto", "saiu", "entregue", "confirmado", "cancelado"],
  pronto: ["saiu", "entregue", "preparando", "cancelado"],
  saiu: ["entregue", "pronto", "cancelado"],
  entregue: [],
  cancelado: [],
};
const PICKUP: Record<OrderStatus, OrderStatus[]> = {
  aguardando: ["confirmado", "preparando", "pronto", "entregue", "cancelado"],
  confirmado: ["preparando", "pronto", "entregue", "aguardando", "cancelado"],
  preparando: ["pronto", "entregue", "confirmado", "cancelado"],
  pronto: ["entregue", "preparando", "cancelado"],
  saiu: [],
  entregue: [],
  cancelado: [],
};

describe("canTransition", () => {
  for (const [fulfillment, table] of [
    ["delivery", DELIVERY],
    ["pickup", PICKUP],
  ] as const) {
    test(`every (from, to) pair for ${fulfillment} matches the ADR-017 table`, () => {
      let checked = 0;
      for (const from of ORDER_STATUSES) {
        for (const to of ORDER_STATUSES) {
          const expected = table[from].includes(to);
          expect(`${fulfillment} ${from}->${to} ${canTransition(from, to, fulfillment)}`).toBe(
            `${fulfillment} ${from}->${to} ${expected}`,
          );
          checked++;
        }
      }
      expect(checked).toBe(49);
    });

    test(`allowedTargets for ${fulfillment} lists the table row (any order)`, () => {
      for (const from of ORDER_STATUSES) {
        expect([...allowedTargets(from, fulfillment)].sort()).toEqual([...table[from]].sort());
      }
    });
  }

  test("forward skips are allowed, backward only one step", () => {
    expect(canTransition("aguardando", "preparando", "delivery")).toBe(true);
    expect(canTransition("preparando", "aguardando", "delivery")).toBe(false);
    expect(canTransition("pronto", "confirmado", "delivery")).toBe(false);
  });

  test("pickup never enters saiu", () => {
    for (const from of ORDER_STATUSES) expect(canTransition(from, "saiu", "pickup")).toBe(false);
  });

  test("final statuses are final", () => {
    expect(isFinalStatus("entregue")).toBe(true);
    expect(isFinalStatus("cancelado")).toBe(true);
    expect(isFinalStatus("pronto")).toBe(false);
  });

  test("a move to the same status is not a transition", () => {
    for (const s of ORDER_STATUSES) expect(canTransition(s, s, "delivery")).toBe(false);
  });
});

describe("applyTransition", () => {
  const at = new Date("2026-10-13T15:00:00Z");
  const actor = { changedBy: "user-1", actorType: "user" as const };
  const order = (status: OrderStatus, fulfillment: Fulfillment = "delivery") => ({ status, fulfillment });

  test("accepted change yields exactly one history record", () => {
    const r = applyTransition(order("aguardando"), "preparando", actor, at);
    expect(r).toEqual({
      kind: "changed",
      status: "preparando",
      history: {
        fromStatus: "aguardando",
        toStatus: "preparando",
        changedBy: "user-1",
        actorType: "user",
        changedAt: at,
      },
      deliveredAt: null,
      cancelledAt: null,
    });
  });

  test("entregue sets deliveredAt, cancelado sets cancelledAt", () => {
    const d = applyTransition(order("saiu"), "entregue", actor, at);
    expect(d.kind === "changed" && d.deliveredAt).toEqual(at);
    const c = applyTransition(order("preparando"), "cancelado", actor, at);
    expect(c.kind === "changed" && c.cancelledAt).toEqual(at);
  });

  test("same status is a no-op with no history", () => {
    expect(applyTransition(order("pronto"), "pronto", actor, at)).toEqual({ kind: "noop" });
  });

  test("rejected change yields no history and lists the allowed targets", () => {
    const r = applyTransition(order("entregue"), "preparando", actor, at);
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") {
      expect(r.error.code).toBe("invalid_status_transition");
      expect(r.error.details?.[0]?.message).toContain("nenhum");
      expect("history" in r).toBe(false);
    }
    const r2 = applyTransition(order("preparando"), "aguardando", actor, at);
    expect(r2.kind).toBe("rejected");
  });

  test("cancel from a final status is rejected (FR-026)", () => {
    expect(applyTransition(order("entregue"), "cancelado", actor, at).kind).toBe("rejected");
    expect(applyTransition(order("cancelado"), "cancelado", actor, at).kind).toBe("noop");
  });

  test("pickup pronto -> entregue works, pronto -> saiu does not", () => {
    expect(applyTransition(order("pronto", "pickup"), "entregue", actor, at).kind).toBe("changed");
    expect(applyTransition(order("pronto", "pickup"), "saiu", actor, at).kind).toBe("rejected");
  });

  test("api key and system actors carry no user id", () => {
    const r = applyTransition(order("aguardando"), "confirmado", { changedBy: null, actorType: "api_key" }, at);
    expect(r.kind === "changed" && r.history.changedBy).toBeNull();
  });
});

describe("initialStatus", () => {
  test("auto-accept starts confirmado, otherwise aguardando", () => {
    expect(initialStatus(true)).toBe("confirmado");
    expect(initialStatus(false)).toBe("aguardando");
  });
});
