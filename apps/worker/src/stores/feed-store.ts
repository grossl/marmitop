// DbFeedStore: the FeedStore over Postgres (ADR-023, FR-174, FR-176). Each event is one
// transaction: `applyUatisEvent` (the same handler the push route uses) plus the cursor.

import type { UatisWebhookEvent } from "@mt/core";
import { type Tx, withRestaurantContext } from "@mt/db";
import { applyUatisEvent, loadWhatsAppConnection, type ServiceDeps, systemCtx, toDbContext } from "@mt/http";

import type { FeedState, FeedStore } from "../handlers/uatis-feed";

export class DbFeedStore implements FeedStore {
  constructor(private readonly deps: ServiceDeps) {}

  private tx<T>(restaurantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRestaurantContext(this.deps.db, toDbContext(systemCtx(restaurantId)), fn, this.deps.contextOptions);
  }

  loadFeedState(restaurantId: string): Promise<FeedState | null> {
    return this.tx(restaurantId, async (tx) => {
      const [row] = await tx<
        { uatis_webhook_id: string | null; uatis_organization_id: string | null; uatis_feed_cursor: string | null }[]
      >`
        select uatis_webhook_id, uatis_organization_id, uatis_feed_cursor
        from public.integrations_whatsapp where restaurant_id = ${restaurantId}
      `;
      if (row === undefined || row.uatis_webhook_id === null) return null;
      const connection = await loadWhatsAppConnection(tx, this.deps, restaurantId);
      if (connection === null) return null;
      return {
        connection,
        webhookId: row.uatis_webhook_id,
        organizationId: row.uatis_organization_id,
        cursor: row.uatis_feed_cursor,
      };
    });
  }

  async applyEvent(restaurantId: string, event: UatisWebhookEvent, eventId: string | null, cursor: string) {
    const result = await this.tx(restaurantId, async (tx) => {
      const applied = await applyUatisEvent(tx, this.deps, restaurantId, event, { eventId, source: "pull" });
      await tx`update public.integrations_whatsapp set uatis_feed_cursor = ${cursor} where restaurant_id = ${restaurantId}`;
      return applied;
    });
    return result.action;
  }

  async setCursor(restaurantId: string, cursor: string | null): Promise<void> {
    await this.tx(
      restaurantId,
      (tx) => tx`update public.integrations_whatsapp set uatis_feed_cursor = ${cursor} where restaurant_id = ${restaurantId}`,
    );
  }

  async clearWebhook(restaurantId: string): Promise<void> {
    await this.tx(
      restaurantId,
      (tx) => tx`
      update public.integrations_whatsapp set
        uatis_webhook_id = null, uatis_webhook_mode = null, uatis_organization_id = null, uatis_feed_cursor = null
      where restaurant_id = ${restaurantId}
    `,
    );
  }

  async markSynced(restaurantId: string, at: Date): Promise<void> {
    await this.tx(
      restaurantId,
      (tx) => tx`update public.integrations_whatsapp set last_synced_at = ${at} where restaurant_id = ${restaurantId}`,
    );
  }

  async markError(restaurantId: string, message: string): Promise<void> {
    await this.tx(
      restaurantId,
      (tx) => tx`
      update public.integrations_whatsapp set status = 'error', last_error = ${message.slice(0, 200)}
      where restaurant_id = ${restaurantId}
    `,
    );
  }
}
