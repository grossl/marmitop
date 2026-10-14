// mt_sync op whatsapp_reconcile: the reconciliation poll (FR-107, FR-108;
// ADR-002 Amendment 1). pg_cron enqueues one job per connected restaurant every
// 30 seconds (`mt.enqueue_whatsapp_sync`).
//
//   from   = last_sync_cursor − 60 s (or now − 24 h on the first poll)
//   read   = GET /v1/messages?direction=in&from=… every page (newest first)
//   apply  = oldest first, one transaction per message, the same
//            `applyGatewayMessage` as the webhook (upsert by external_id,
//            then automatic messages)
//   cursor = the newest created_at seen, written after every message applied
//
// The overlap and the external_id upsert make a repeated poll harmless. A
// database error stops before the cursor moves; the retry reads again.

import { type Clock, classifyUpstreamFailure, type GatewayMessage, GatewayError, type WhatsAppGateway } from "@mt/core";
import { QUEUES } from "@mt/db";
import type { GatewayConnection } from "@mt/http";
import { type SyncJob, syncJobSchema } from "@mt/schemas";

import type { JobHandler, Logger } from "../framework/types";

export const OVERLAP_MS = 60_000;
export const FIRST_POLL_LOOKBACK_MS = 24 * 3600_000;
export const MAX_PAGES = 20;

export interface ReconcileConnection extends GatewayConnection {
  readonly phoneNumberId: string;
  readonly status: "disconnected" | "connected" | "error";
  readonly lastSyncCursor: Date | null;
}

export interface ReconcileStore {
  loadConnection(restaurantId: string): Promise<ReconcileConnection | null>;
  /** One transaction: upsert plus automatic messages. */
  applyMessage(restaurantId: string, message: GatewayMessage): Promise<string>;
  /** Writes `last_sync_cursor` (when not null) and `last_synced_at`. */
  advanceCursor(restaurantId: string, cursor: Date | null, syncedAt: Date): Promise<void>;
  /** A permanent failure (refused key, refused host): status `error` with allow-listed text. */
  markError(restaurantId: string, message: string): Promise<void>;
}

export interface ReconcileHandlerDeps {
  readonly store: ReconcileStore;
  readonly gatewayFor: (conn: GatewayConnection) => WhatsAppGateway;
  readonly clock: Clock;
  readonly log: Logger;
  readonly pageSize?: number;
}

function pollErrorMessage(code: string): string {
  if (code === "unauthorized" || code === "forbidden") return "A chave de API foi recusada pelo backend-uatis.";
  if (code === "host_not_allowed") return "Endereço do backend-uatis não permitido.";
  return "A leitura de mensagens do backend-uatis falhou.";
}

export function createWhatsAppReconcileHandler(deps: ReconcileHandlerDeps): JobHandler<SyncJob> {
  const { store } = deps;
  const pageSize = deps.pageSize ?? 100;
  return {
    name: "whatsapp.reconcile",
    queue: QUEUES.sync,
    op: "whatsapp_reconcile",
    schema: syncJobSchema,
    subjectType: "sync",
    subjectId: () => null,
    // Up to MAX_PAGES reads at 10 s each, plus the writes.
    visibilityTimeoutSeconds: 300,

    async run({ payload }) {
      const conn = await store.loadConnection(payload.restaurantId);
      if (conn === null || conn.status !== "connected") return { kind: "ok" };

      const now = deps.clock.now();
      const from = conn.lastSyncCursor
        ? new Date(conn.lastSyncCursor.getTime() - OVERLAP_MS)
        : new Date(now.getTime() - FIRST_POLL_LOOKBACK_MS);
      const gateway = deps.gatewayFor({ baseUrl: conn.baseUrl, apiKey: conn.apiKey });

      const seen: GatewayMessage[] = [];
      try {
        let cursor: string | null = null;
        let pages = 0;
        do {
          const page = await gateway.listMessages({ direction: "in", from, cursor, limit: pageSize });
          seen.push(...page.items);
          cursor = page.nextCursor;
          pages++;
        } while (cursor !== null && pages < MAX_PAGES);
        if (cursor !== null) {
          deps.log.warn("reconcile page cap reached; older messages in this window are skipped", {
            restaurantId: payload.restaurantId,
            pages,
          });
        }
      } catch (error) {
        if (!(error instanceof GatewayError)) throw error;
        const httpStatus = error.failure.kind === "http" ? error.failure.status : undefined;
        const c = classifyUpstreamFailure(error.failure);
        if (c.failure === "transient") {
          return {
            kind: "retry",
            errorCode: c.errorCode,
            ...(httpStatus !== undefined ? { httpStatus } : {}),
            ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
          };
        }
        await store.markError(payload.restaurantId, pollErrorMessage(c.errorCode));
        return { kind: "fail", errorCode: c.errorCode, ...(httpStatus !== undefined ? { httpStatus } : {}) };
      }

      const ordered = [...new Map(seen.map((m) => [m.externalId, m])).values()].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.externalId.localeCompare(b.externalId),
      );
      let newest: Date | null = null;
      for (const m of ordered) {
        await store.applyMessage(payload.restaurantId, m);
        if (newest === null || m.createdAt > newest) newest = m.createdAt;
      }
      const previous = conn.lastSyncCursor;
      const cursor = newest && (!previous || newest > previous) ? newest : previous;
      await store.advanceCursor(payload.restaurantId, cursor, now);
      return { kind: "ok" };
    },
  };
}
