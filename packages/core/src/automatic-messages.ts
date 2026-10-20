// Automatic messages (FR-110..FR-115, FR-117, FR-200..FR-205, ADR-014, ADR-015, ADR-026).
// Pure decisions: the service stores the message row and enqueues the job in the same
// transaction.

import { type BusinessHoursRow, isOpenAt } from "./business-hours";
import { type Fulfillment, isForwardOrCancel, type OrderStatus } from "./order-status";
import { decideServiceWindow } from "./service-window";

/** ADR-026: one kind per target status, in board order. */
export const ORDER_STATUS_MESSAGE_KINDS = [
  "order_confirmed",
  "order_preparing",
  "order_ready",
  "order_out_for_delivery",
  "order_delivered",
  "order_cancelled",
] as const;
export type OrderStatusMessageKind = (typeof ORDER_STATUS_MESSAGE_KINDS)[number];

export type AutomaticKind = "welcome" | "closed" | "order_received" | OrderStatusMessageKind;

/** The target status of each status message. `aguardando` has none: `order_received` covers creation. */
const KIND_BY_STATUS: Readonly<Partial<Record<OrderStatus, OrderStatusMessageKind>>> = {
  confirmado: "order_confirmed",
  preparando: "order_preparing",
  pronto: "order_ready",
  saiu: "order_out_for_delivery",
  entregue: "order_delivered",
  cancelado: "order_cancelled",
};

export interface AutomaticMessageConfig {
  readonly enabled: boolean;
  readonly body: string;
  readonly templateName: string | null;
  readonly templateLanguage: string | null;
}

export type AutomaticMessagesConfig = Readonly<Record<AutomaticKind, AutomaticMessageConfig>>;

/** ADR-015: at most one `closed` message per conversation in any 12 hours. */
export const CLOSED_NOTICE_INTERVAL_MS = 12 * 60 * 60 * 1000;

export interface MessageVariables {
  readonly nome?: string;
  readonly restaurante?: string;
  readonly pedido?: string;
}

const KNOWN = new Set(["nome", "restaurante", "pedido"]);

/** FR-115. Unknown variables, and known ones with no value, stay as text. One pass, so values are never re-expanded. */
export function renderMessage(body: string, vars: MessageVariables): string {
  return body.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (whole, name: string) => {
    if (!KNOWN.has(name)) return whole;
    const value = vars[name as keyof MessageVariables];
    return value === undefined ? whole : value;
  });
}

export interface InboundAutoMessageInput {
  /** Direction of the message that triggered the check. Only `in` can trigger. */
  readonly direction: "in" | "out";
  readonly isNewConversation: boolean;
  readonly closedNoticeSentAt: Date | null;
  readonly hours: readonly BusinessHoursRow[];
  readonly timezone: string;
  readonly now: Date;
  readonly config: AutomaticMessagesConfig;
  readonly customerName: string;
  readonly restaurantName: string;
}

export interface AutoMessageDecision {
  readonly kind: "welcome" | "closed";
  readonly body: string;
}

/**
 * Welcome and closed replies always follow an inbound message, so they are inside the
 * service window and never blocked. If both would match, only `closed` goes out.
 * When the decision is `closed`, the caller sets `conversations.closed_notice_sent_at`.
 */
export function decideInboundAutoMessage(input: InboundAutoMessageInput): AutoMessageDecision | null {
  if (input.direction !== "in") return null;
  const vars = { nome: input.customerName, restaurante: input.restaurantName };

  const closed = input.config.closed;
  if (closed.enabled && !isOpenAt(input.hours, input.timezone, input.now)) {
    const last = input.closedNoticeSentAt;
    if (!last || input.now.getTime() - last.getTime() >= CLOSED_NOTICE_INTERVAL_MS) {
      return { kind: "closed", body: renderMessage(closed.body, vars) };
    }
  }

  const welcome = input.config.welcome;
  if (welcome.enabled && input.isNewConversation) {
    return { kind: "welcome", body: renderMessage(welcome.body, vars) };
  }
  return null;
}

export interface OrderReceivedInput {
  readonly config: AutomaticMessagesConfig;
  readonly hasConversation: boolean;
  readonly lastInboundAt: Date | null;
  readonly now: Date;
  readonly orderCode: string;
  readonly customerName: string;
  readonly restaurantName: string;
}

/** The outcome of a message that follows the 24-hour window (FR-117). */
export type WindowedDecision<K extends AutomaticKind> =
  | { readonly action: "send_text"; readonly kind: K; readonly body: string }
  | {
      readonly action: "send_template";
      readonly kind: K;
      readonly body: string;
      readonly templateName: string;
      readonly templateLanguage: string;
    }
  | {
      readonly action: "fail";
      readonly kind: K;
      readonly body: string;
      readonly errorCode: "outside_service_window";
    };

export type OrderReceivedDecision =
  | { readonly action: "skip"; readonly reason: "disabled" | "no_conversation" }
  | WindowedDecision<"order_received">;

/** Text inside the window, the kind's template outside it, a failed row with no template (FR-117, ADR-014). */
function decideWindowed<K extends AutomaticKind>(
  kind: K,
  cfg: AutomaticMessageConfig,
  body: string,
  lastInboundAt: Date | null,
  now: Date,
): WindowedDecision<K> {
  const decision = decideServiceWindow({
    lastInboundAt,
    now,
    template:
      cfg.templateName && cfg.templateLanguage ? { name: cfg.templateName, language: cfg.templateLanguage } : null,
  });
  if (decision.mode === "text") return { action: "send_text", kind, body };
  if (decision.mode === "template") {
    return {
      action: "send_template",
      kind,
      body,
      templateName: decision.templateName,
      templateLanguage: decision.templateLanguage,
    };
  }
  return { action: "fail", kind, body, errorCode: decision.errorCode };
}

/** FR-112 and FR-117: text inside the window, the configured template outside it, a failed row with no template. */
export function decideOrderReceived(input: OrderReceivedInput): OrderReceivedDecision {
  const cfg = input.config.order_received;
  if (!cfg.enabled) return { action: "skip", reason: "disabled" };
  if (!input.hasConversation) return { action: "skip", reason: "no_conversation" };
  const body = renderMessage(cfg.body, {
    nome: input.customerName,
    restaurante: input.restaurantName,
    pedido: input.orderCode,
  });
  return decideWindowed("order_received", cfg, body, input.lastInboundAt, input.now);
}

/**
 * FR-201, FR-202. The status message kind for a move, or null when the move sends
 * none: a back step, a no-op, an illegal move, or `pronto` on a delivery order.
 * A forward skip gives only the target's kind.
 */
export function orderStatusMessageKind(
  from: OrderStatus,
  to: OrderStatus,
  fulfillment: Fulfillment,
): OrderStatusMessageKind | null {
  if (!isForwardOrCancel(from, to, fulfillment)) return null;
  const kind = KIND_BY_STATUS[to] ?? null;
  if (kind === "order_ready" && fulfillment !== "pickup") return null;
  return kind;
}

export interface OrderStatusMessageInput {
  readonly config: AutomaticMessagesConfig;
  readonly from: OrderStatus;
  readonly to: OrderStatus;
  readonly fulfillment: Fulfillment;
  readonly hasConversation: boolean;
  /** True when this order already has a `messages` row of the move's kind (FR-203). */
  readonly alreadySent: boolean;
  readonly lastInboundAt: Date | null;
  readonly now: Date;
  readonly orderCode: string;
  readonly customerName: string;
  readonly restaurantName: string;
}

export type OrderStatusMessageDecision =
  | {
      readonly action: "skip";
      readonly reason: "no_message" | "no_conversation" | "disabled" | "already_sent";
    }
  | WindowedDecision<OrderStatusMessageKind>;

/** FR-201 to FR-205, ADR-026. */
export function decideOrderStatusMessage(input: OrderStatusMessageInput): OrderStatusMessageDecision {
  const kind = orderStatusMessageKind(input.from, input.to, input.fulfillment);
  if (kind === null) return { action: "skip", reason: "no_message" };
  if (!input.hasConversation) return { action: "skip", reason: "no_conversation" };
  const cfg = input.config[kind];
  if (!cfg.enabled) return { action: "skip", reason: "disabled" };
  if (input.alreadySent) return { action: "skip", reason: "already_sent" };
  const body = renderMessage(cfg.body, {
    nome: input.customerName,
    restaurante: input.restaurantName,
    pedido: input.orderCode,
  });
  return decideWindowed(kind, cfg, body, input.lastInboundAt, input.now);
}
