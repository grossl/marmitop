// POST /v1/webhooks/uatis/{restaurant_id} (FR-102..FR-106, FR-118, FR-119, FR-175, FR-176;
// 06.api-spec.md, 07.security.md "Inbound webhook verification"; ADR-021, ADR-023).
//
// `receiveUatisWebhook` is the whole route minus HTTP plumbing. Order:
//
//   1. body over 256 KB                → 413 (before any lookup)
//   2. load the secret and the stored organization (uuid check, integration row, not
//      disconnected, a secret configured)
//   3. verify X-Uatis-Signature: 5-minute tolerance, HMAC over "t.body",
//      constant-time compare. An unknown restaurant verifies against a dummy
//      secret, so every failure costs the same and answers the same 401 body
//      (no oracle, FR-118)
//   4. rate limit per restaurant (after the signature, so unsigned traffic
//      cannot spend a restaurant's budget)
//   5. parse JSON (422); `organization_id` must match the stored organization, else the
//      same 401 (FR-175); parse the event (422 with field paths)
//   6. accept: `applyUatisEvent` (receipt dedupe by event id, then upsert by external_id and
//      automatic messages) and `last_webhook_at`, in one transaction (FR-176)
//
// The store is a port: `createDbUatisInboundStore` in production, a memory
// store in the api tests.

import { randomBytes } from "node:crypto";

import {
  AppError,
  type ErrorBody,
  MAX_WEBHOOK_BODY_BYTES,
  parseUatisWebhookEvent,
  type UatisWebhookEvent,
  verifyUatisSignature,
} from "@mt/core";
import { type Db, type RateClass, withoutContext, withRestaurantContext } from "@mt/db";

import type { ServiceDeps } from "../../deps";
import { mapError } from "../../errors";
import { loadUatisWebhookVerification, systemCtx } from "./connection";
import { toDbContext } from "../../context";
import {
  applyUatisEvent,
  type UatisEventResult,
  uatisEventId,
  uatisOrganizationAllowed,
} from "./uatis-events";

/** 06.api-spec.md "Rate limits": inbound webhook routes get 300 per minute per restaurant. */
export const WEBHOOK_RATE_LIMIT_PER_MINUTE = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Verified against when the restaurant has no secret, so the work matches a real check. */
const DUMMY_SECRET = randomBytes(32).toString("hex");

export interface RateDecision {
  readonly allowed: boolean;
  /** Seconds until the window resets. */
  readonly retryAfterSeconds: number;
  /** Requests counted in this window, this one included. */
  readonly count: number;
}

export interface UatisWebhookVerification {
  /** The unsealed webhook secret. */
  readonly secret: string;
  /** `uatis_organization_id`; null skips the organization check (FR-175). */
  readonly organizationId: string | null;
}

export interface UatisInboundStore {
  /** Null: unknown restaurant, no integration, disconnected, or no secret configured. */
  loadVerification(restaurantId: string): Promise<UatisWebhookVerification | null>;
  hit(restaurantId: string, now: Date): Promise<RateDecision>;
  /** One transaction: `applyUatisEvent` and `last_webhook_at = receivedAt` (FR-176). */
  accept(
    restaurantId: string,
    event: UatisWebhookEvent,
    meta: { readonly eventId: string | null; readonly receivedAt: Date },
  ): Promise<UatisEventResult>;
}

export interface WebhookReply {
  readonly status: number;
  readonly body: ErrorBody | { readonly received: true };
  readonly headers?: Readonly<Record<string, string>>;
  /** Set for a 5xx: the caller logs it. Never sent to the client. */
  readonly cause?: unknown;
}

export interface ReceiveInput {
  readonly restaurantId: string;
  readonly signatureHeader: string | null | undefined;
  /** `X-Uatis-Delivery`; the dedupe key when the body has no usable `id`. */
  readonly deliveryHeader?: string | null | undefined;
  readonly rawBody: Uint8Array;
  readonly now: Date;
}

function reply(error: AppError, headers?: Record<string, string>): WebhookReply {
  return { status: error.httpStatus, body: error.toErrorBody(), ...(headers ? { headers } : {}) };
}

const SIGNATURE_INVALID = () => new AppError("signature_invalid", "Webhook signature is invalid.");

export async function receiveUatisWebhook(store: UatisInboundStore, input: ReceiveInput): Promise<WebhookReply> {
  if (input.rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES) {
    return reply(new AppError("signature_invalid", "Webhook signature is invalid.", { httpStatus: 413 }));
  }
  try {
    const verification = UUID.test(input.restaurantId) ? await store.loadVerification(input.restaurantId) : null;
    const check = verifyUatisSignature({
      headers: { "X-Uatis-Signature": input.signatureHeader ?? undefined },
      rawBody: input.rawBody,
      secret: verification?.secret ?? DUMMY_SECRET,
      now: input.now,
    });
    if (verification === null || !check.ok) return reply(SIGNATURE_INVALID());

    const rate = await store.hit(input.restaurantId, input.now);
    if (!rate.allowed) {
      return reply(new AppError("rate_limited", "Too many webhook requests for this restaurant."), {
        "Retry-After": String(rate.retryAfterSeconds),
      });
    }

    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(input.rawBody));
    } catch {
      return reply(new AppError("validation_failed", "The webhook body is not JSON."));
    }
    const organizationId =
      typeof json === "object" && json !== null && typeof (json as { organization_id?: unknown }).organization_id === "string"
        ? ((json as { organization_id: string }).organization_id as string)
        : null;
    if (!uatisOrganizationAllowed(verification.organizationId, organizationId)) return reply(SIGNATURE_INVALID());

    const event = parseUatisWebhookEvent(json);
    await store.accept(input.restaurantId, event, {
      eventId: uatisEventId(event, input.deliveryHeader),
      receivedAt: input.now,
    });
    return { status: 200, body: { received: true } };
  } catch (error) {
    const mapped = mapError(error);
    return { status: mapped.status, body: mapped.body, ...(mapped.unexpected ? { cause: error } : {}) };
  }
}

/** Fixed one-minute window in `rate_counters` (not a tenant table; it runs before the context). */
export async function hitRateCounter(
  db: Db,
  subjectId: string,
  cls: RateClass,
  limit: number,
  now: Date,
): Promise<RateDecision> {
  const windowStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const count = await withoutContext(
    db,
    async (tx) => {
      const [row] = await tx<{ count: number }[]>`
        insert into public.rate_counters (subject_id, class, window_start, count)
        values (${subjectId}, ${cls}, ${windowStart}, 1)
        on conflict (subject_id, class, window_start) do update set count = public.rate_counters.count + 1
        returning count
      `;
      return row?.count ?? 1;
    },
    "app_service",
  );
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart.getTime() + 60_000 - now.getTime()) / 1000));
  return { allowed: count <= limit, retryAfterSeconds, count };
}

/** The production store: secrets from `secrets`, events through `applyUatisEvent`. */
export function createDbUatisInboundStore(deps: ServiceDeps): UatisInboundStore {
  const inContext = <T>(restaurantId: string, fn: Parameters<typeof withRestaurantContext<T>>[2]) =>
    withRestaurantContext(deps.db, toDbContext(systemCtx(restaurantId)), fn, deps.contextOptions);
  return {
    loadVerification: (restaurantId) =>
      inContext(restaurantId, (tx) => loadUatisWebhookVerification(tx, deps, restaurantId)),
    hit: (restaurantId, now) => hitRateCounter(deps.db, restaurantId, "webhook", WEBHOOK_RATE_LIMIT_PER_MINUTE, now),
    accept: (restaurantId, event, meta) =>
      inContext(restaurantId, async (tx) => {
        const result = await applyUatisEvent(tx, deps, restaurantId, event, { eventId: meta.eventId, source: "push" });
        await tx`
          update public.integrations_whatsapp set last_webhook_at = ${meta.receivedAt}
          where restaurant_id = ${restaurantId}
        `;
        return result;
      }),
  };
}
