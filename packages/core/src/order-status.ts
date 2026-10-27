// Order status machine (ADR-017, ADR-028, FR-021..FR-029, 05.data-model.md "Order status transitions").
// The database trigger enforces the same table as a backstop.

import { AppError } from "./errors";

export const ORDER_STATUSES = ["aguardando", "confirmado", "pronto", "saiu", "finalizado", "cancelado"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type Fulfillment = "delivery" | "pickup";
export type ActorType = "user" | "api_key" | "system";

// ADR-028: no `preparando`; `finalizado` closes the order.
const FLOW_DELIVERY: readonly OrderStatus[] = ["aguardando", "confirmado", "pronto", "saiu", "finalizado"];
const FLOW_PICKUP: readonly OrderStatus[] = ["aguardando", "confirmado", "pronto", "finalizado"];

export function isFinalStatus(status: OrderStatus): boolean {
  return status === "finalizado" || status === "cancelado";
}

function flowFor(fulfillment: Fulfillment): readonly OrderStatus[] {
  return fulfillment === "delivery" ? FLOW_DELIVERY : FLOW_PICKUP;
}

/** True when `from -> to` is a legal, state-changing move. The same status is not a move. */
export function canTransition(from: OrderStatus, to: OrderStatus, fulfillment: Fulfillment): boolean {
  if (from === to || isFinalStatus(from)) return false;
  const flow = flowFor(fulfillment);
  const fromIdx = flow.indexOf(from);
  // a pickup order can never hold `saiu`, so no move leaves it (the database check forbids the state)
  if (fromIdx < 0) return false;
  if (to === "cancelado") return true;
  const toIdx = flow.indexOf(to);
  if (toIdx < 0) return false;
  // forward moves may skip columns; backward moves go one step only
  return toIdx > fromIdx || toIdx === fromIdx - 1;
}

/**
 * True for a legal forward move (a skip included) or a cancel; false for a back
 * step, a no-op, or an illegal move. ADR-026 sends a status message only then.
 */
export function isForwardOrCancel(from: OrderStatus, to: OrderStatus, fulfillment: Fulfillment): boolean {
  if (!canTransition(from, to, fulfillment)) return false;
  if (to === "cancelado") return true;
  const flow = flowFor(fulfillment);
  return flow.indexOf(to) > flow.indexOf(from);
}

export function allowedTargets(from: OrderStatus, fulfillment: Fulfillment): OrderStatus[] {
  return ORDER_STATUSES.filter((to) => canTransition(from, to, fulfillment));
}

/** FR-029: a new order starts as `confirmado` when auto-accept is on. */
export function initialStatus(autoAccept: boolean): OrderStatus {
  return autoAccept ? "confirmado" : "aguardando";
}

export interface TransitionActor {
  readonly changedBy: string | null;
  readonly actorType: ActorType;
}

/** One `order_status_history` row (FR-023). */
export interface StatusHistoryEntry {
  readonly fromStatus: OrderStatus | null;
  readonly toStatus: OrderStatus;
  readonly changedBy: string | null;
  readonly actorType: ActorType;
  readonly changedAt: Date;
}

export type TransitionResult =
  | { readonly kind: "noop" }
  | {
      readonly kind: "changed";
      readonly status: OrderStatus;
      readonly history: StatusHistoryEntry;
      readonly deliveredAt: Date | null;
      readonly cancelledAt: Date | null;
    }
  | { readonly kind: "rejected"; readonly error: AppError };

export function applyTransition(
  order: { readonly status: OrderStatus; readonly fulfillment: Fulfillment },
  to: OrderStatus,
  actor: TransitionActor,
  at: Date,
): TransitionResult {
  if (order.status === to) return { kind: "noop" };
  if (!canTransition(order.status, to, order.fulfillment)) {
    const allowed = allowedTargets(order.status, order.fulfillment);
    return {
      kind: "rejected",
      error: new AppError("invalid_status_transition", `Cannot move an order from ${order.status} to ${to}.`, {
        details: [
          {
            path: "status",
            code: "invalid_status_transition",
            message: allowed.length > 0 ? `Allowed: ${allowed.join(", ")}` : "Allowed: nenhum (final status).",
          },
        ],
      }),
    };
  }
  return {
    kind: "changed",
    status: to,
    history: {
      fromStatus: order.status,
      toStatus: to,
      changedBy: actor.changedBy,
      actorType: actor.actorType,
      changedAt: at,
    },
    // `delivered_at` keeps its name; it is the time the order was finalized (ADR-028).
    deliveredAt: to === "finalizado" ? at : null,
    cancelledAt: to === "cancelado" ? at : null,
  };
}

/** Throwing form for services that prefer exceptions. */
export function assertTransition(from: OrderStatus, to: OrderStatus, fulfillment: Fulfillment): void {
  const r = applyTransition({ status: from, fulfillment }, to, { changedBy: null, actorType: "system" }, new Date(0));
  if (r.kind === "rejected") throw r.error;
}
