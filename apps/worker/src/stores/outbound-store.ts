// DbOutboundStore: the OutboundStore over Postgres (05.data-model.md "messages",
// migration 0015). Every method is its own transaction under the restaurant's
// `system` context, so the claim commits before the HTTP call (ADR-017 #4).

import type { MessageStatus } from "@mt/core";
import { type Tx, withRestaurantContext } from "@mt/db";
import { loadWhatsAppConnection, type ServiceDeps, systemCtx, toDbContext } from "@mt/http";

import type { ClaimResult, OutboundStore } from "../handlers/outbound-message";

interface MessageRow {
  direction: "in" | "out";
  status: MessageStatus;
  external_id: string | null;
  send_claimed_at: Date | null;
  body: string;
  template_name: string | null;
  template_language: string | null;
  phone: string;
}

export class DbOutboundStore implements OutboundStore {
  constructor(private readonly deps: ServiceDeps) {}

  private tx<T>(restaurantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRestaurantContext(this.deps.db, toDbContext(systemCtx(restaurantId)), fn, this.deps.contextOptions);
  }

  claim(restaurantId: string, messageId: string): Promise<ClaimResult> {
    return this.tx(restaurantId, async (tx) => {
      const [m] = await tx<MessageRow[]>`
        select m.direction, m.status, m.external_id, m.send_claimed_at, m.body, m.template_name, m.template_language,
               cu.phone
        from public.messages m
        join public.conversations c on c.restaurant_id = m.restaurant_id and c.id = m.conversation_id
        join public.customers cu on cu.restaurant_id = c.restaurant_id and cu.id = c.customer_id
        where m.restaurant_id = ${restaurantId} and m.id = ${messageId}
        for update of m
      `;
      if (m === undefined || m.direction !== "out") return { kind: "skip", reason: "not_found" };
      if (m.external_id !== null) return { kind: "skip", reason: "already_sent" };
      if (m.status !== "pending") return { kind: "skip", reason: "not_pending" };
      if (m.send_claimed_at !== null) return { kind: "already_claimed" };

      const conn = await loadWhatsAppConnection(tx, this.deps, restaurantId);
      if (conn === null || conn.status === "disconnected") return { kind: "not_configured" };

      await tx`
        update public.messages set send_claimed_at = now()
        where id = ${messageId} and restaurant_id = ${restaurantId}
      `;
      return {
        kind: "claimed",
        message: {
          to: m.phone,
          body: m.body,
          template:
            m.template_name && m.template_language ? { name: m.template_name, language: m.template_language } : null,
        },
        connection: { baseUrl: conn.baseUrl, apiKey: conn.apiKey, phoneNumberId: conn.phoneNumberId },
      };
    });
  }

  async markSent(restaurantId: string, messageId: string, externalId: string, status: MessageStatus): Promise<void> {
    await this.tx(
      restaurantId,
      (tx) => tx`
      update public.messages set
        external_id = ${externalId},
        status = case when status in ('pending', 'failed') then ${status} else status end,
        error_code = null,
        error_message = null
      where id = ${messageId} and restaurant_id = ${restaurantId}
    `,
    );
  }

  async markFailed(restaurantId: string, messageId: string, errorCode: string, errorMessage: string): Promise<void> {
    await this.tx(
      restaurantId,
      (tx) => tx`
      update public.messages set status = 'failed', error_code = ${errorCode}, error_message = ${errorMessage.slice(0, 200)}
      where id = ${messageId} and restaurant_id = ${restaurantId} and status = 'pending'
    `,
    );
  }

  async release(restaurantId: string, messageId: string): Promise<void> {
    await this.tx(
      restaurantId,
      (tx) => tx`
      update public.messages set send_claimed_at = null
      where id = ${messageId} and restaurant_id = ${restaurantId} and external_id is null
    `,
    );
  }
}
