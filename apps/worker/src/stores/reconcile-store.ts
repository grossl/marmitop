// DbReconcileStore: the ReconcileStore over Postgres. Each message is its own
// transaction through the same `applyGatewayMessage` the webhook uses.

import type { GatewayMessage } from "@mt/core";
import { type Tx, withRestaurantContext } from "@mt/db";
import { applyGatewayMessage, loadWhatsAppConnection, type ServiceDeps, systemCtx, toDbContext } from "@mt/http";

import type { ReconcileConnection, ReconcileStore } from "../handlers/whatsapp-reconcile";

export class DbReconcileStore implements ReconcileStore {
  constructor(private readonly deps: ServiceDeps) {}

  private tx<T>(restaurantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRestaurantContext(this.deps.db, toDbContext(systemCtx(restaurantId)), fn, this.deps.contextOptions);
  }

  loadConnection(restaurantId: string): Promise<ReconcileConnection | null> {
    return this.tx(restaurantId, (tx) => loadWhatsAppConnection(tx, this.deps, restaurantId));
  }

  async applyMessage(restaurantId: string, message: GatewayMessage): Promise<string> {
    const result = await this.tx(restaurantId, (tx) => applyGatewayMessage(tx, this.deps, restaurantId, message));
    return result.action;
  }

  async advanceCursor(restaurantId: string, cursor: Date | null, syncedAt: Date): Promise<void> {
    await this.tx(
      restaurantId,
      (tx) => tx`
      update public.integrations_whatsapp set
        last_sync_cursor = coalesce(${cursor}::timestamptz, last_sync_cursor),
        last_synced_at = ${syncedAt},
        last_polled_at = ${syncedAt}
      where restaurant_id = ${restaurantId}
    `,
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
