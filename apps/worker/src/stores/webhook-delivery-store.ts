// DbWebhookDeliveryStore: the WebhookDeliveryStore over Postgres (05.data-model.md
// "webhook_deliveries"). Each method is its own transaction under the restaurant's
// `system` context. The load locks the row, so two reads of one job cannot interleave
// their bookkeeping.

import { type Tx, withRestaurantContext } from "@mt/db";
import {
  loadDeliveryForSend,
  markDeliveryExhausted,
  recordDeliveryAttempt,
  type ServiceDeps,
  systemCtx,
  toDbContext,
} from "@mt/http";

import type { DeliveryAttempt, LoadedDelivery, WebhookDeliveryStore } from "../handlers/webhook-delivery";

export class DbWebhookDeliveryStore implements WebhookDeliveryStore {
  constructor(private readonly deps: ServiceDeps) {}

  private tx<T>(restaurantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRestaurantContext(this.deps.db, toDbContext(systemCtx(restaurantId)), fn, this.deps.contextOptions);
  }

  load(restaurantId: string, deliveryId: string): Promise<LoadedDelivery | null> {
    return this.tx(restaurantId, (tx) => loadDeliveryForSend(tx, this.deps, restaurantId, deliveryId));
  }

  recordAttempt(restaurantId: string, deliveryId: string, attempt: DeliveryAttempt): Promise<void> {
    return this.tx(restaurantId, (tx) => recordDeliveryAttempt(tx, restaurantId, deliveryId, attempt));
  }

  markExhausted(restaurantId: string, deliveryId: string, errorCode: string): Promise<void> {
    return this.tx(restaurantId, (tx) => markDeliveryExhausted(tx, restaurantId, deliveryId, errorCode));
  }
}
