// In-memory UatisInboundStore for the apps/api route tests. It keeps one row per
// (restaurant, external_id), so a replay changes nothing, as the database does, and one
// receipt per (restaurant, event id), as `uatis_event_receipts` does (ADR-023).

import { nextMessageStatus, type MessageStatus, type UatisWebhookEvent } from "@mt/core";

import type { RateDecision, UatisInboundStore, UatisWebhookVerification } from "../services/whatsapp/inbound-webhook";
import type { UatisEventResult } from "../services/whatsapp/uatis-events";

type MessageEvent = Extract<UatisWebhookEvent, { message: unknown }>;

export class MemoryUatisInboundStore implements UatisInboundStore {
  readonly secrets = new Map<string, string>();
  /** Stored `uatis_organization_id` per restaurant; absent means null (no check). */
  readonly organizations = new Map<string, string>();
  readonly applied: { restaurantId: string; event: MessageEvent }[] = [];
  readonly rows = new Map<string, { status: MessageStatus }>();
  readonly receipts = new Map<string, Set<string>>();
  readonly lastWebhookAt = new Map<string, Date>();
  duplicates = 0;
  limitPerMinute = 300;
  secretLookups = 0;
  failApply: Error | null = null;
  private readonly counts = new Map<string, number>();

  async loadVerification(restaurantId: string): Promise<UatisWebhookVerification | null> {
    this.secretLookups++;
    const secret = this.secrets.get(restaurantId);
    return secret === undefined ? null : { secret, organizationId: this.organizations.get(restaurantId) ?? null };
  }

  async hit(restaurantId: string, now: Date): Promise<RateDecision> {
    const window = Math.floor(now.getTime() / 60_000);
    const key = `${restaurantId}:${window}`;
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    const retryAfterSeconds = Math.max(1, Math.ceil(((window + 1) * 60_000 - now.getTime()) / 1000));
    return { allowed: count <= this.limitPerMinute, retryAfterSeconds, count };
  }

  async accept(
    restaurantId: string,
    event: UatisWebhookEvent,
    meta: { eventId: string | null; receivedAt: Date },
  ): Promise<UatisEventResult> {
    if (this.failApply) throw this.failApply;
    const seen = this.receipts.get(restaurantId) ?? new Set<string>();
    this.receipts.set(restaurantId, seen);
    this.lastWebhookAt.set(restaurantId, meta.receivedAt);
    if (meta.eventId !== null) {
      if (seen.has(meta.eventId)) {
        this.duplicates++;
        return { action: "duplicate" };
      }
      seen.add(meta.eventId);
    }
    if (event.type !== "message.created" && event.type !== "message.updated") return { action: "not_a_message" };
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
