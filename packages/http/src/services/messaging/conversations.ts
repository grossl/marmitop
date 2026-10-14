// Conversations and messages (FR-010..FR-019, 06.api-spec.md Appendix A:
// listConversations, getConversation, markConversationRead, sendMessage).
// Attendant and admin.

import { AppError, assertFreeTextAllowed, isWithinServiceWindow, SERVICE_WINDOW_MS } from "@mt/core";
import { QUEUES, sendJob, type Tx } from "@mt/db";
import {
  conversationIdActionSchema,
  listConversationsActionSchema,
  type OutboundMessageJob,
  retryMessageActionSchema,
  sendMessageActionSchema,
} from "@mt/schemas";

import type { z } from "zod";

import type { ServiceContext } from "../../context";
import type { ServiceDeps } from "../../deps";
import { defineService } from "../../service";
import { type CustomerOrderSummary, listCustomerOrders } from "./customer-orders";
import { decodeCursor, encodeCursor, likePattern, previewOf } from "./helpers";

export interface ConversationSummary {
  readonly id: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly customerPhone: string;
  readonly lastMessageAt: string | null;
  readonly lastMessagePreview: string | null;
  readonly unreadCount: number;
  readonly lastInboundAt: string | null;
}

export interface MessageDto {
  readonly id: string;
  readonly direction: "in" | "out";
  readonly body: string;
  readonly status: "pending" | "sent" | "delivered" | "read" | "failed";
  readonly orderId: string | null;
  readonly orderCode: string | null;
  readonly automaticKind: string | null;
  readonly errorCode: string | null;
  readonly createdAt: string;
}

export interface ConversationDetail {
  readonly conversation: ConversationSummary;
  /** True when free text may be sent now (ADR-014). */
  readonly windowOpen: boolean;
  /** When the window closes, or null when it is already closed. */
  readonly windowClosesAt: string | null;
  readonly messages: readonly MessageDto[];
  readonly orders: readonly CustomerOrderSummary[];
}

interface ConversationRow {
  id: string;
  customer_id: string;
  name: string;
  phone: string;
  last_message_at: Date | null;
  last_message_preview: string | null;
  unread_count: number;
  last_inbound_at: Date | null;
}

function toSummary(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.name,
    customerPhone: row.phone,
    lastMessageAt: row.last_message_at?.toISOString() ?? null,
    lastMessagePreview: row.last_message_preview,
    unreadCount: row.unread_count,
    lastInboundAt: row.last_inbound_at?.toISOString() ?? null,
  };
}

const PAGE_DEFAULT = 100;

export const listConversations = defineService({
  name: "messages.listConversations",
  minRole: "attendant",
  input: listConversationsActionSchema,
  run: async ({ tx, ctx, input }) => {
    const limit = input.limit ?? PAGE_DEFAULT;
    const offset = decodeCursor(input.cursor);
    const pattern = likePattern(input.q);
    const rows = await tx<ConversationRow[]>`
      select c.id, c.customer_id, cu.name, cu.phone, c.last_message_at, c.last_message_preview,
             c.unread_count, c.last_inbound_at
      from public.conversations c
      join public.customers cu on cu.restaurant_id = c.restaurant_id and cu.id = c.customer_id
      where c.restaurant_id = ${ctx.restaurantId}
        and (${pattern}::text is null
             or cu.name ilike ${pattern} or cu.phone ilike ${pattern} or c.last_message_preview ilike ${pattern})
      order by c.last_message_at desc nulls last, c.created_at desc, c.id
      limit ${limit + 1} offset ${offset}
    `;
    const page = rows.slice(0, limit);
    return {
      items: page.map(toSummary),
      nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null,
    };
  },
});

async function loadConversation(tx: Tx, restaurantId: string, conversationId: string): Promise<ConversationRow> {
  const [row] = await tx<ConversationRow[]>`
    select c.id, c.customer_id, cu.name, cu.phone, c.last_message_at, c.last_message_preview,
           c.unread_count, c.last_inbound_at
    from public.conversations c
    join public.customers cu on cu.restaurant_id = c.restaurant_id and cu.id = c.customer_id
    where c.restaurant_id = ${restaurantId} and c.id = ${conversationId}
  `;
  if (row === undefined) throw new AppError("not_found", "Conversation not found.");
  return row;
}

const MESSAGES_PAGE = 200;

/** Messages and linked orders; marks the conversation read (FR-012, FR-013, FR-018). */
export const getConversation = defineService({
  name: "messages.getConversation",
  minRole: "attendant",
  input: conversationIdActionSchema,
  run: async ({ tx, ctx, deps, input }) => {
    const row = await loadConversation(tx, ctx.restaurantId, input.conversationId);

    // Only when unread: a second open writes nothing, so Realtime stays quiet.
    await tx`
      update public.conversations set unread_count = 0
      where id = ${row.id} and restaurant_id = ${ctx.restaurantId} and unread_count > 0
    `;

    const messages = await tx<
      {
        id: string;
        direction: "in" | "out";
        body: string;
        status: MessageDto["status"];
        order_id: string | null;
        order_code: string | null;
        automatic_kind: string | null;
        error_code: string | null;
        created_at: Date;
      }[]
    >`
      select * from (
        select m.id, m.direction, m.body, m.status, m.order_id, o.code as order_code,
               m.automatic_kind, m.error_code, m.created_at
        from public.messages m
        left join public.orders o on o.restaurant_id = m.restaurant_id and o.id = m.order_id
        where m.restaurant_id = ${ctx.restaurantId} and m.conversation_id = ${row.id}
        order by m.created_at desc, m.id desc
        limit ${MESSAGES_PAGE}
      ) recent
      order by created_at asc, id asc
    `;

    const orders = await listCustomerOrders(tx, ctx.restaurantId, row.customer_id, 20);
    const now = deps.clock.now();
    const windowOpen = isWithinServiceWindow(row.last_inbound_at, now);
    return {
      conversation: toSummary({ ...row, unread_count: 0 }),
      windowOpen,
      windowClosesAt:
        windowOpen && row.last_inbound_at
          ? new Date(row.last_inbound_at.getTime() + SERVICE_WINDOW_MS).toISOString()
          : null,
      messages: messages.map(
        (m): MessageDto => ({
          id: m.id,
          direction: m.direction,
          body: m.body,
          status: m.status,
          orderId: m.order_id,
          orderCode: m.order_code,
          automaticKind: m.automatic_kind,
          errorCode: m.error_code,
          createdAt: m.created_at.toISOString(),
        }),
      ),
      orders,
    } satisfies ConversationDetail;
  },
});

export const markConversationRead = defineService({
  name: "messages.markConversationRead",
  minRole: "attendant",
  input: conversationIdActionSchema,
  run: async ({ tx, ctx, input }) => {
    const rows = await tx<{ id: string }[]>`
      update public.conversations set unread_count = 0
      where id = ${input.conversationId} and restaurant_id = ${ctx.restaurantId}
      returning id
    `;
    if (rows.length === 0) throw new AppError("not_found", "Conversation not found.");
    return { conversationId: input.conversationId };
  },
});

async function enqueueOutbound(tx: Tx, restaurantId: string, messageId: string): Promise<void> {
  const job: OutboundMessageJob = { v: 1, restaurantId, messageId };
  await sendJob(tx, QUEUES.outboundMessages, job);
}

function userIdOf(ctx: ServiceContext): string | null {
  return ctx.actorType === "user" ? ctx.userId : null;
}

/**
 * FR-014: window check first (FR-117, ADR-014), then the `pending` row, the
 * conversation preview, and the pgmq job in one transaction. The worker (P5)
 * delivers it.
 */
export const sendMessage = defineService({
  name: "messages.send",
  minRole: "attendant",
  input: sendMessageActionSchema,
  run: ({ tx, ctx, deps, input }) => sendMessageInTx(tx, deps, ctx, input),
});

/** The send, in the caller's transaction. `POST /v1/messages` runs it too (06.api-spec.md). */
export async function sendMessageInTx(
  tx: Tx,
  deps: ServiceDeps,
  ctx: ServiceContext,
  input: z.output<typeof sendMessageActionSchema>,
): Promise<{ messageId: string; conversationId: string }> {
  const conversation = await loadConversation(tx, ctx.restaurantId, input.conversationId);
  assertFreeTextAllowed(conversation.last_inbound_at, deps.clock.now());

  if (input.orderId !== undefined) {
    const [order] = await tx<{ id: string }[]>`
        select id from public.orders
        where id = ${input.orderId} and restaurant_id = ${ctx.restaurantId} and customer_id = ${conversation.customer_id}
      `;
    if (order === undefined) {
      throw new AppError("validation_failed", "The order does not belong to this customer.", {
        details: [{ path: "orderId", code: "custom", message: "Pedido não encontrado para este cliente." }],
      });
    }
  }

  const [message] = await tx<{ id: string; created_at: Date }[]>`
      insert into public.messages (restaurant_id, conversation_id, direction, body, status, order_id, sent_by)
      values (${ctx.restaurantId}, ${conversation.id}, 'out', ${input.body}, 'pending',
              ${input.orderId ?? null}, ${userIdOf(ctx)})
      returning id, created_at
    `;
  if (message === undefined) throw new AppError("forbidden", "Your role cannot perform this action.");

  await tx`
      update public.conversations set
        last_message_at = ${message.created_at},
        last_message_preview = ${previewOf(input.body)}
      where id = ${conversation.id} and restaurant_id = ${ctx.restaurantId}
    `;
  await enqueueOutbound(tx, ctx.restaurantId, message.id);
  return { messageId: message.id, conversationId: conversation.id };
}

/** FR-019: a failed message goes back to `pending` and is enqueued again. */
export const retryMessage = defineService({
  name: "messages.retry",
  minRole: "attendant",
  input: retryMessageActionSchema,
  run: async ({ tx, ctx, deps, input }) => {
    const [message] = await tx<
      { id: string; conversation_id: string; status: string; direction: string; template_name: string | null }[]
    >`
      select id, conversation_id, status, direction, template_name from public.messages
      where id = ${input.messageId} and restaurant_id = ${ctx.restaurantId}
    `;
    if (message === undefined) throw new AppError("not_found", "Message not found.");
    if (message.direction !== "out" || message.status !== "failed") {
      throw new AppError("conflict", "Only a failed outbound message can be retried.");
    }
    const conversation = await loadConversation(tx, ctx.restaurantId, message.conversation_id);
    // An approved template may go out after the 24-hour window (ADR-014); free text may not.
    if (message.template_name === null) assertFreeTextAllowed(conversation.last_inbound_at, deps.clock.now());

    const rows = await tx<{ id: string }[]>`
      update public.messages set status = 'pending', error_code = null, error_message = null, send_claimed_at = null
      where id = ${message.id} and restaurant_id = ${ctx.restaurantId} and status = 'failed'
      returning id
    `;
    if (rows.length === 0) throw new AppError("conflict", "Only a failed outbound message can be retried.");
    await enqueueOutbound(tx, ctx.restaurantId, message.id);
    return { messageId: message.id };
  },
});
