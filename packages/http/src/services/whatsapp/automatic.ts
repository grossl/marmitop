// Automatic messages (FR-110..FR-115, FR-117, FR-200..FR-205; ADR-007, ADR-014, ADR-015, ADR-026).
//
// The decisions are pure (`@mt/core` automatic-messages.ts). This file loads
// their inputs and stores the result inside the caller's transaction: a
// `messages` row (direction `out`, `sent_by` null, `automatic_kind` set) and
// an `mt_outbound_messages` job, so a rollback drops both (outbox, ADR-007).

import {
  type AutomaticKind,
  type AutomaticMessagesConfig,
  type BusinessHoursRow,
  decideInboundAutoMessage,
  decideOrderReceived,
  decideOrderStatusMessage,
  type Fulfillment,
  ORDER_STATUS_MESSAGE_KINDS,
  type OrderStatus,
  orderStatusMessageKind,
} from "@mt/core";
import { QUEUES, sendJob, type Tx } from "@mt/db";
import type { OutboundMessageJob } from "@mt/schemas";

import type { ServiceDeps } from "../../deps";
import { previewOf } from "../messaging/helpers";
import { aiWillAnswer } from "../ai/trigger";

const KINDS: readonly AutomaticKind[] = ["welcome", "closed", "order_received", ...ORDER_STATUS_MESSAGE_KINDS];

export interface AutomationSettings {
  readonly config: AutomaticMessagesConfig;
  readonly hours: readonly BusinessHoursRow[];
  readonly timezone: string;
  readonly restaurantName: string;
}

export async function loadAutomationSettings(tx: Tx, restaurantId: string): Promise<AutomationSettings> {
  const rows = await tx<
    {
      kind: AutomaticKind;
      enabled: boolean;
      body: string;
      template_name: string | null;
      template_language: string | null;
    }[]
  >`
    select kind, enabled, body, template_name, template_language
    from public.automatic_messages where restaurant_id = ${restaurantId}
  `;
  const config = Object.fromEntries(
    KINDS.map((kind) => {
      const row = rows.find((r) => r.kind === kind);
      // A missing row is a disabled message.
      return [
        kind,
        {
          enabled: row?.enabled ?? false,
          body: row?.body ?? "",
          templateName: row?.template_name ?? null,
          templateLanguage: row?.template_language ?? null,
        },
      ];
    }),
  ) as unknown as AutomaticMessagesConfig;

  const hours = await tx<{ weekday: number; enabled: boolean; opens_at: string; closes_at: string }[]>`
    select weekday, enabled, opens_at::text, closes_at::text
    from public.business_hours where restaurant_id = ${restaurantId}
  `;
  const [meta] = await tx<{ name: string; timezone: string | null }[]>`
    select r.name, s.timezone
    from public.restaurants r
    left join public.restaurant_settings s on s.restaurant_id = r.id
    where r.id = ${restaurantId}
  `;
  return {
    config,
    hours: hours.map((h) => ({ weekday: h.weekday, enabled: h.enabled, opensAt: h.opens_at, closesAt: h.closes_at })),
    timezone: meta?.timezone ?? "America/Sao_Paulo",
    restaurantName: meta?.name ?? "",
  };
}

export interface AutomaticRowInput {
  readonly conversationId: string;
  readonly kind: AutomaticKind;
  readonly body: string;
  readonly orderId?: string | null;
  readonly template?: { readonly name: string; readonly language: string } | null;
  /** Set for an order message that cannot go out (FR-117, FR-204): stored `failed`, never enqueued. */
  readonly failure?: { readonly code: string; readonly message: string } | null;
  readonly at: Date;
}

/** Inserts the row, moves the conversation preview, and enqueues the send unless the row is already `failed`. */
export async function storeAutomaticMessage(tx: Tx, restaurantId: string, input: AutomaticRowInput): Promise<string> {
  const failed = input.failure ?? null;
  const [row] = await tx<{ id: string }[]>`
    insert into public.messages (
      restaurant_id, conversation_id, direction, body, status, order_id, sent_by, automatic_kind,
      template_name, template_language, error_code, error_message, created_at
    ) values (
      ${restaurantId}, ${input.conversationId}, 'out', ${input.body}, ${failed ? "failed" : "pending"},
      ${input.orderId ?? null}, null, ${input.kind},
      ${input.template?.name ?? null}, ${input.template?.language ?? null},
      ${failed?.code ?? null}, ${failed?.message ?? null}, ${input.at}
    )
    returning id
  `;
  if (row === undefined) throw new Error("automatic message insert returned no row");
  await tx`
    update public.conversations set
      last_message_at = greatest(coalesce(last_message_at, ${input.at}::timestamptz), ${input.at}::timestamptz),
      last_message_preview = ${previewOf(input.body)}
    where id = ${input.conversationId} and restaurant_id = ${restaurantId}
  `;
  if (!failed) {
    const job: OutboundMessageJob = { v: 1, restaurantId, messageId: row.id };
    await sendJob(tx, QUEUES.outboundMessages, job);
  }
  return row.id;
}

export interface InboundAutomationInput {
  readonly conversationId: string;
  readonly conversationCreated: boolean;
  readonly customerName: string;
}

export interface AutomaticResult {
  readonly kind: AutomaticKind;
  readonly messageId: string;
}

/**
 * FR-110, FR-111, FR-113, ADR-015. Call it after a new (not duplicate) inbound
 * message is stored, in the same transaction. The inbound ingest already
 * updated the conversation row, so this transaction holds its lock: two
 * concurrent inbound messages cannot both send `closed` inside 12 hours.
 */
export async function runInboundAutomation(
  tx: Tx,
  deps: ServiceDeps,
  restaurantId: string,
  input: InboundAutomationInput,
): Promise<AutomaticResult | null> {
  const settings = await loadAutomationSettings(tx, restaurantId);
  const [conv] = await tx<{ closed_notice_sent_at: Date | null }[]>`
    select closed_notice_sent_at from public.conversations
    where id = ${input.conversationId} and restaurant_id = ${restaurantId}
    for update
  `;
  if (conv === undefined) return null;
  const now = deps.clock.now();
  const decision = decideInboundAutoMessage({
    direction: "in",
    isNewConversation: input.conversationCreated,
    closedNoticeSentAt: conv.closed_notice_sent_at,
    hours: settings.hours,
    timezone: settings.timezone,
    now,
    config: settings.config,
    customerName: input.customerName,
    restaurantName: settings.restaurantName,
  });
  if (decision === null) return null;
  // FR-214, ADR-029: the AI greets when it will answer this message, so no second greeting.
  if (decision.kind === "welcome" && (await aiWillAnswer(tx, deps, restaurantId, input.conversationId))) return null;
  // The automatic reply sorts after the message that triggered it.
  const at = new Date(now.getTime() + 1);
  const messageId = await storeAutomaticMessage(tx, restaurantId, {
    conversationId: input.conversationId,
    kind: decision.kind,
    body: decision.body,
    at,
  });
  if (decision.kind === "closed") {
    await tx`
      update public.conversations set closed_notice_sent_at = ${now}
      where id = ${input.conversationId} and restaurant_id = ${restaurantId}
    `;
  }
  return { kind: decision.kind, messageId };
}

export interface OrderReceivedInput {
  readonly orderId: string;
  readonly orderCode: string;
  readonly customerName: string;
  /** The order's WhatsApp conversation; null for a counter order (FR-112). */
  readonly conversationId: string | null;
}

export type OrderReceivedOutcome =
  | { readonly action: "skip"; readonly reason: "disabled" | "no_conversation" }
  | { readonly action: "send_text" | "send_template" | "fail"; readonly messageId: string };

const OUTSIDE_WINDOW_MESSAGE = "Fora da janela de 24h e sem modelo aprovado.";

/** FR-039, FR-112, FR-117, ADR-014. Runs in the order's transaction. */
export async function enqueueOrderReceived(
  tx: Tx,
  deps: ServiceDeps,
  restaurantId: string,
  input: OrderReceivedInput,
): Promise<OrderReceivedOutcome> {
  const settings = await loadAutomationSettings(tx, restaurantId);
  let lastInboundAt: Date | null = null;
  if (input.conversationId !== null) {
    const [conv] = await tx<{ last_inbound_at: Date | null }[]>`
      select last_inbound_at from public.conversations
      where id = ${input.conversationId} and restaurant_id = ${restaurantId}
    `;
    lastInboundAt = conv?.last_inbound_at ?? null;
  }
  const now = deps.clock.now();
  const decision = decideOrderReceived({
    config: settings.config,
    hasConversation: input.conversationId !== null,
    lastInboundAt,
    now,
    orderCode: input.orderCode,
    customerName: input.customerName,
    restaurantName: settings.restaurantName,
  });
  if (decision.action === "skip" || input.conversationId === null) {
    return { action: "skip", reason: decision.action === "skip" ? decision.reason : "no_conversation" };
  }
  const messageId = await storeAutomaticMessage(tx, restaurantId, {
    conversationId: input.conversationId,
    kind: "order_received",
    body: decision.body,
    orderId: input.orderId,
    template:
      decision.action === "send_template" ? { name: decision.templateName, language: decision.templateLanguage } : null,
    failure: decision.action === "fail" ? { code: decision.errorCode, message: OUTSIDE_WINDOW_MESSAGE } : null,
    at: now,
  });
  return { action: decision.action, messageId };
}

export interface OrderStatusMessageInput {
  readonly orderId: string;
  readonly orderCode: string;
  readonly from: OrderStatus;
  readonly to: OrderStatus;
  readonly fulfillment: Fulfillment;
  /** The order's WhatsApp conversation; null for a counter order. */
  readonly conversationId: string | null;
  readonly customerId: string;
  readonly now: Date;
}

export type OrderStatusMessageOutcome =
  | { readonly action: "skip"; readonly reason: "no_message" | "no_conversation" | "disabled" | "already_sent" }
  | { readonly action: "send_text" | "send_template" | "fail"; readonly messageId: string };

/**
 * FR-201 to FR-205, ADR-026. Runs in the status change's transaction, after the
 * order update. The caller holds the order row lock, so two moves of one order
 * cannot both pass the once-per-kind check (FR-203).
 */
export async function enqueueOrderStatusMessage(
  tx: Tx,
  restaurantId: string,
  input: OrderStatusMessageInput,
): Promise<OrderStatusMessageOutcome> {
  // Cheap exits first: most moves need no lookups.
  const kind = orderStatusMessageKind(input.from, input.to, input.fulfillment);
  if (kind === null) return { action: "skip", reason: "no_message" };
  if (input.conversationId === null) return { action: "skip", reason: "no_conversation" };

  const settings = await loadAutomationSettings(tx, restaurantId);
  if (!settings.config[kind].enabled) return { action: "skip", reason: "disabled" };

  const [sent] = await tx<{ n: number }[]>`
    select count(*)::int as n from public.messages
    where restaurant_id = ${restaurantId} and order_id = ${input.orderId} and automatic_kind = ${kind}
  `;
  const [conv] = await tx<{ last_inbound_at: Date | null }[]>`
    select last_inbound_at from public.conversations
    where id = ${input.conversationId} and restaurant_id = ${restaurantId}
  `;
  const [customer] = await tx<{ name: string }[]>`
    select name from public.customers where restaurant_id = ${restaurantId} and id = ${input.customerId}
  `;
  const decision = decideOrderStatusMessage({
    config: settings.config,
    from: input.from,
    to: input.to,
    fulfillment: input.fulfillment,
    hasConversation: conv !== undefined,
    alreadySent: (sent?.n ?? 0) > 0,
    lastInboundAt: conv?.last_inbound_at ?? null,
    now: input.now,
    orderCode: input.orderCode,
    customerName: customer?.name ?? "",
    restaurantName: settings.restaurantName,
  });
  if (decision.action === "skip") return decision;
  const messageId = await storeAutomaticMessage(tx, restaurantId, {
    conversationId: input.conversationId,
    kind: decision.kind,
    body: decision.body,
    orderId: input.orderId,
    template:
      decision.action === "send_template" ? { name: decision.templateName, language: decision.templateLanguage } : null,
    failure: decision.action === "fail" ? { code: decision.errorCode, message: OUTSIDE_WINDOW_MESSAGE } : null,
    at: input.now,
  });
  return { action: decision.action, messageId };
}
