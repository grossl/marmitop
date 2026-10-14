// POST /v1/webhooks/uatis/{restaurant_id} (FR-102..FR-106, FR-118, FR-119;
// 06.api-spec.md, 07.security.md "Inbound webhook verification").
//
// `receiveUatisWebhook` is the whole route minus HTTP plumbing. Order:
//
//   1. body over 256 KB                → 413 (before any lookup)
//   2. load the secret (uuid check, integration row, not disconnected)
//   3. verify X-Uatis-Signature: 5-minute tolerance, HMAC over "t.body",
//      constant-time compare. An unknown restaurant verifies against a dummy
//      secret, so every failure costs the same and answers the same 401 body
//      (no oracle, FR-118)
//   4. rate limit per restaurant (after the signature, so unsigned traffic
//      cannot spend a restaurant's budget)
//   5. parse JSON and the event (422 with field paths)
//   6. apply: upsert by external_id, automatic messages, in one transaction
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
import { type Db, withoutContext, withRestaurantContext } from "@mt/db";

import type { ServiceDeps } from "../../deps";
import { mapError } from "../../errors";
import { loadUatisWebhookSecret, systemCtx } from "./connection";
import { type ApplyResult, applyGatewayMessage } from "./gateway-events";
import { toDbContext } from "../../context";

/** 06.api-spec.md "Rate limits": inbound webhook routes get 300 per minute per restaurant. */
export const WEBHOOK_RATE_LIMIT_PER_MINUTE = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Verified against when the restaurant has no secret, so the work matches a real check. */
const DUMMY_SECRET = randomBytes(32).toString("hex");

export interface RateDecision {
  readonly allowed: boolean;
  /** Seconds until the window resets. */
  readonly retryAfterSeconds: number;
}

export interface UatisInboundStore {
  /** The unsealed webhook secret, or null: unknown restaurant, no integration, or disconnected. */
  loadSecret(restaurantId: string): Promise<string | null>;
  hit(restaurantId: string, now: Date): Promise<RateDecision>;
  apply(restaurantId: string, event: Extract<UatisWebhookEvent, { message: unknown }>): Promise<ApplyResult>;
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
    const secret = UUID.test(input.restaurantId) ? await store.loadSecret(input.restaurantId) : null;
    const check = verifyUatisSignature({
      headers: { "X-Uatis-Signature": input.signatureHeader ?? undefined },
      rawBody: input.rawBody,
      secret: secret ?? DUMMY_SECRET,
      now: input.now,
    });
    if (secret === null || !check.ok) return reply(SIGNATURE_INVALID());

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
    const event = parseUatisWebhookEvent(json);
    if (event.type === "message.created" || event.type === "message.updated") {
      await store.apply(input.restaurantId, event);
    }
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
  cls: "read" | "write" | "webhook",
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
  return { allowed: count <= limit, retryAfterSeconds };
}

/** The production store: secrets from `secrets`, rows through `applyGatewayMessage`. */
export function createDbUatisInboundStore(deps: ServiceDeps): UatisInboundStore {
  const inContext = <T>(restaurantId: string, fn: Parameters<typeof withRestaurantContext<T>>[2]) =>
    withRestaurantContext(deps.db, toDbContext(systemCtx(restaurantId)), fn, deps.contextOptions);
  return {
    loadSecret: (restaurantId) => inContext(restaurantId, (tx) => loadUatisWebhookSecret(tx, deps, restaurantId)),
    hit: (restaurantId, now) => hitRateCounter(deps.db, restaurantId, "webhook", WEBHOOK_RATE_LIMIT_PER_MINUTE, now),
    apply: (restaurantId, event) =>
      inContext(restaurantId, (tx) => applyGatewayMessage(tx, deps, restaurantId, event.message)),
  };
}
