// Automatic messages (FR-110..FR-115, FR-117, ADR-014, ADR-015). Pure decisions: the
// service stores the message row and enqueues the job in the same transaction.

import { type BusinessHoursRow, isOpenAt } from "./business-hours";
import { decideServiceWindow } from "./service-window";

export type AutomaticKind = "welcome" | "closed" | "order_received";

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

export type OrderReceivedDecision =
  | { readonly action: "skip"; readonly reason: "disabled" | "no_conversation" }
  | { readonly action: "send_text"; readonly kind: "order_received"; readonly body: string }
  | {
      readonly action: "send_template";
      readonly kind: "order_received";
      readonly body: string;
      readonly templateName: string;
      readonly templateLanguage: string;
    }
  | {
      readonly action: "fail";
      readonly kind: "order_received";
      readonly body: string;
      readonly errorCode: "outside_service_window";
    };

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
  const decision = decideServiceWindow({
    lastInboundAt: input.lastInboundAt,
    now: input.now,
    template:
      cfg.templateName && cfg.templateLanguage ? { name: cfg.templateName, language: cfg.templateLanguage } : null,
  });
  if (decision.mode === "text") return { action: "send_text", kind: "order_received", body };
  if (decision.mode === "template") {
    return {
      action: "send_template",
      kind: "order_received",
      body,
      templateName: decision.templateName,
      templateLanguage: decision.templateLanguage,
    };
  }
  return { action: "fail", kind: "order_received", body, errorCode: decision.errorCode };
}
