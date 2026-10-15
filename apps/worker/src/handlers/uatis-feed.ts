// mt_sync op uatis_feed_pull: read the backend-uatis event feed (ADR-023; FR-174..FR-176).
//
// The worker timer calls `mt.enqueue_uatis_feed_pulls(MT_UATIS_PULL_SECONDS)`, which enqueues one
// job per connected restaurant with a registered webhook: every MT_UATIS_PULL_SECONDS in pull
// mode, every 5 minutes in push mode (recovery of lost pushes).
//
//   read   = GET /v1/webhooks/{id}/events?after=<uatis_feed_cursor>&limit=100, oldest first,
//            at most MAX_PAGES pages per run
//   apply  = per event, one transaction: `applyUatisEvent` (receipt dedupe by event id, then the
//            same message handling as a push) and `uatis_feed_cursor = event.cursor`. The cursor
//            therefore moves only after its event commits. A database error stops the run with
//            the cursor at the last committed event; the retry reads again.
//   skip   = a malformed event or one from another organization: warn, move the cursor on
//   paging = `next_cursor` is the last event's cursor and echoes `after` when nothing is new, so
//            it never means "more"; a full page (events.length === limit) does
//   410    = cursor_expired: reset the cursor to null and warn; the next run reads the 7-day
//            retention from the start, and the receipts absorb the repeats
//   400    = a foreign or invalid cursor (validation_failed on `after`): same reset
//   404    = GET /v1/webhooks/{id} tells the cases apart. The webhook exists: an older
//            backend-uatis without the feed, so run the timestamp poll. It is gone: clear the
//            webhook columns (the 30-second timestamp poll takes over) and run the poll now
//   403    = the API key is not admin: integration `error` with the pt-BR text
//
// Known risk (ADR-023): a backend-uatis transaction that commits more than 2 s after it started can
// land behind the cursor. Push covers it; in pull mode `mt.enqueue_whatsapp_sync` still runs the
// timestamp poll every 10 minutes as a safety net (migration 0019).

import {
  AppError,
  type Clock,
  GatewayError,
  parseUatisWebhookEvent,
  type UatisWebhookEvent,
  type WhatsAppGateway,
} from "@mt/core";
import { QUEUES } from "@mt/db";
import { type GatewayConnection, uatisEventId, uatisOrganizationAllowed } from "@mt/http";
import { type UatisFeedPullJob, uatisFeedPullJobSchema } from "@mt/schemas";

import type { JobHandler, JobOutcome, Logger } from "../framework/types";
import {
  gatewayFailure,
  MAX_PAGES,
  type ReconcileConnection,
  type ReconcileStore,
  runTimestampPoll,
} from "./whatsapp-reconcile";

export interface FeedState {
  readonly connection: ReconcileConnection;
  readonly webhookId: string | null;
  /** `uatis_organization_id`; null skips the organization check. */
  readonly organizationId: string | null;
  readonly cursor: string | null;
}

export interface FeedStore {
  loadFeedState(restaurantId: string): Promise<FeedState | null>;
  /** One transaction: `applyUatisEvent` (source `pull`) and `uatis_feed_cursor = cursor`. Returns the action. */
  applyEvent(restaurantId: string, event: UatisWebhookEvent, eventId: string | null, cursor: string): Promise<string>;
  setCursor(restaurantId: string, cursor: string | null): Promise<void>;
  /** The webhook is gone at backend-uatis: clear `uatis_webhook_*` and the cursor. */
  clearWebhook(restaurantId: string): Promise<void>;
  /** `last_synced_at`: the feed cadence reads it. */
  markSynced(restaurantId: string, at: Date): Promise<void>;
  markError(restaurantId: string, message: string): Promise<void>;
}

export interface FeedHandlerDeps {
  readonly store: FeedStore;
  /** For the 404 fallback to the timestamp poll. */
  readonly reconcileStore: ReconcileStore;
  readonly gatewayFor: (conn: GatewayConnection) => WhatsAppGateway;
  readonly clock: Clock;
  readonly log: Logger;
  readonly pageSize?: number;
}

/** Shown in Settings as the integration error (ADR-023: webhooks and the feed need role admin). */
export const ADMIN_KEY_REQUIRED = "A chave da API do Uatis precisa ser de administrador.";

function isStatus(error: GatewayError, status: number): boolean {
  return error.failure.kind === "http" && error.failure.status === status;
}

export function createUatisFeedHandler(deps: FeedHandlerDeps): JobHandler<UatisFeedPullJob> {
  return {
    name: "whatsapp.feed",
    queue: QUEUES.sync,
    op: "uatis_feed_pull",
    schema: uatisFeedPullJobSchema,
    subjectType: "sync",
    subjectId: () => null,
    // Up to MAX_PAGES reads at 10 s each, plus the writes.
    visibilityTimeoutSeconds: 300,
    run: ({ payload }) => runFeedPull(deps, payload.restaurantId),
  };
}

export async function runFeedPull(deps: FeedHandlerDeps, restaurantId: string): Promise<JobOutcome> {
  const { store, log } = deps;
  const state = await store.loadFeedState(restaurantId);
  if (state === null || state.webhookId === null || state.connection.status !== "connected") return { kind: "ok" };

  const gateway = deps.gatewayFor({ baseUrl: state.connection.baseUrl, apiKey: state.connection.apiKey });
  const pageSize = deps.pageSize ?? 100;
  let cursor = state.cursor;
  let pages = 0;
  try {
    for (;;) {
      const page = await gateway.listWebhookEvents(state.webhookId, { after: cursor, limit: pageSize });
      pages++;
      for (const item of page.events) {
        let event: UatisWebhookEvent;
        try {
          event = parseUatisWebhookEvent(item.event);
        } catch (e) {
          if (!(e instanceof AppError)) throw e;
          log.warn("uatis feed: malformed event skipped", { restaurantId });
          await store.setCursor(restaurantId, item.cursor);
          cursor = item.cursor;
          continue;
        }
        if (!uatisOrganizationAllowed(state.organizationId, event.organizationId)) {
          log.warn("uatis feed: event from another organization skipped", { restaurantId });
          await store.setCursor(restaurantId, item.cursor);
          cursor = item.cursor;
          continue;
        }
        await store.applyEvent(restaurantId, event, uatisEventId(event), item.cursor);
        cursor = item.cursor;
      }
      if (page.events.length < pageSize) break;
      if (pages >= MAX_PAGES) {
        log.warn("uatis feed page cap reached; the next run continues", { restaurantId, pages });
        break;
      }
    }
  } catch (error) {
    if (!(error instanceof GatewayError)) throw error;
    if (isStatus(error, 410) || (isStatus(error, 400) && cursor !== null)) {
      log.warn("uatis feed cursor expired or refused; reading from the start of the retention", {
        restaurantId,
        status: error.failure.kind === "http" ? error.failure.status : null,
      });
      await store.setCursor(restaurantId, null);
      await store.markSynced(restaurantId, deps.clock.now());
      return { kind: "ok" };
    }
    if (isStatus(error, 404)) {
      let exists: boolean;
      try {
        exists = (await gateway.getWebhook(state.webhookId)) !== null;
      } catch (inner) {
        if (!(inner instanceof GatewayError)) throw inner;
        return gatewayFailure(inner, (message) => store.markError(restaurantId, message));
      }
      if (exists) {
        log.info("uatis feed not supported by this backend-uatis; timestamp poll instead", { restaurantId });
      } else {
        log.warn("uatis webhook no longer exists at backend-uatis; cleared, timestamp poll instead", { restaurantId });
        await store.clearWebhook(restaurantId);
      }
      return runTimestampPoll(
        {
          store: deps.reconcileStore,
          gatewayFor: deps.gatewayFor,
          clock: deps.clock,
          log,
          ...(deps.pageSize ? { pageSize: deps.pageSize } : {}),
        },
        restaurantId,
      );
    }
    if (isStatus(error, 403)) {
      await store.markError(restaurantId, ADMIN_KEY_REQUIRED);
      return { kind: "fail", errorCode: "forbidden", httpStatus: 403 };
    }
    return gatewayFailure(error, (message) => store.markError(restaurantId, message));
  }
  await store.markSynced(restaurantId, deps.clock.now());
  return { kind: "ok" };
}
