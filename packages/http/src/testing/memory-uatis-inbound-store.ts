// In-memory UatisInboundStore for the apps/api route tests. It keeps one row per
// (restaurant, external_id), so a replay changes nothing, as the database does.

import { nextMessageStatus, type MessageStatus, type UatisWebhookEvent } from "@mt/core";

import type { ApplyResult } from "../services/whatsapp/gateway-events";
import type { RateDecision, UatisInboundStore } from "../services/whatsapp/inbound-webhook";

type MessageEvent = Extract<UatisWebhookEvent, { message: unknown }>;

export class MemoryUatisInboundStore implements UatisInboundStore {
  readonly secrets = new Map<string, string>();
  readonly applied: { restaurantId: string; event: MessageEvent }[] = [];
  readonly rows = new Map<string, { status: MessageStatus }>();
  limitPerMinute = 300;
  secretLookups = 0;
  failApply: Error | null = null;
  private readonly counts = new Map<string, number>();

  async loadSecret(restaurantId: string): Promise<string | null> {
    this.secretLookups++;
    return this.secrets.get(restaurantId) ?? null;
  }

  async hit(restaurantId: string, now: Date): Promise<RateDecision> {
    const window = Math.floor(now.getTime() / 60_000);
    const key = `${restaurantId}:${window}`;
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    const retryAfterSeconds = Math.max(1, Math.ceil(((window + 1) * 60_000 - now.getTime()) / 1000));
    return { allowed: count <= this.limitPerMinute, retryAfterSeconds, count };
  }

  async apply(restaurantId: string, event: MessageEvent): Promise<ApplyResult> {
    if (this.failApply) throw this.failApply;
    this.applied.push({ restaurantId, event });
    const key = `${restaurantId}:${event.message.externalId}`;
    const row = this.rows.get(key);
    if (row) {
      const next = nextMessageStatus(row.status, event.message.status);
      if (next === row.status) return { action: "unchanged" };
      row.status = next;
      return { action: "status_updated", status: next };
    }
    this.rows.set(key, { status: event.message.status ?? "delivered" });
    return { action: "ingested", messageId: key, conversationId: "conv", automatic: null };
  }
}
