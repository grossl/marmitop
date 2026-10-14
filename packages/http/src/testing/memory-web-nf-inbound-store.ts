// In-memory WebNfInboundStore for the apps/api route tests. It keeps one status per web-nf
// invoice id and applies the same status rule as the database (core decideInvoiceUpdate),
// so a replayed delivery changes nothing (FR-136).

import { decideInvoiceUpdate, type InvoiceRowState, type NfWebhookEvent, nfWebhookStatus } from "@mt/core";

import type { WebNfApplyResult, WebNfInboundStore } from "../services/invoices/inbound-webhook";
import type { RateDecision } from "../services/whatsapp/inbound-webhook";

export class MemoryWebNfInboundStore implements WebNfInboundStore {
  readonly secrets = new Map<string, string>();
  readonly applied: { restaurantId: string; event: NfWebhookEvent }[] = [];
  /** Known invoices by `restaurantId:externalId`. */
  readonly rows = new Map<string, InvoiceRowState>();
  readonly refreshes: string[] = [];
  limitPerMinute = 300;
  secretLookups = 0;
  failApply: Error | null = null;
  private readonly counts = new Map<string, number>();

  addInvoice(restaurantId: string, externalId: string, status: InvoiceRowState["status"] = "queued"): void {
    this.rows.set(`${restaurantId}:${externalId}`, {
      status,
      numero: null,
      serie: null,
      chaveAcesso: null,
      errorCode: null,
      errorMessage: null,
    });
  }

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

  async apply(restaurantId: string, event: NfWebhookEvent): Promise<WebNfApplyResult> {
    if (this.failApply) throw this.failApply;
    this.applied.push({ restaurantId, event });
    if (!event.type.startsWith("invoice.") && !event.type.startsWith("event.")) return { action: "ignored" };
    const key = `${restaurantId}:${event.invoice.id}`;
    const row = this.rows.get(key);
    if (!row) return { action: "unknown_invoice" };
    if (event.type.startsWith("event.")) {
      this.refreshes.push(event.invoice.id);
      return { action: "applied", changed: false, refreshQueued: true };
    }
    const status = nfWebhookStatus(event.type);
    if (status === null) return { action: "ignored" };
    const d = decideInvoiceUpdate(row, {
      status,
      numero: event.invoice.numero,
      chaveAcesso: event.invoice.chaveAcesso,
    });
    if (!d.apply) return { action: "applied", changed: false, refreshQueued: false };
    this.rows.set(key, { ...row, ...d.patch });
    return { action: "applied", changed: true, refreshQueued: false };
  }
}
