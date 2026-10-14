// POST /v1/webhooks/web-nf/{restaurant_id} (FR-126, FR-127, FR-136; 06.api-spec.md,
// 07.security.md "Inbound webhook verification").
//
// `receiveWebNfWebhook` is the whole route minus HTTP plumbing. The same seven steps as the
// backend-uatis route (services/whatsapp/inbound-webhook.ts):
//
//   1. body over 256 KB                → 413 (before any lookup)
//   2. load the secret (uuid check, fiscal integration row, not disconnected)
//   3. verify X-NF-Signature: 5-minute tolerance, HMAC over "t.body", constant-time compare.
//      An unknown restaurant verifies against a dummy secret, so every failure costs the same
//      and answers the same 401 body (no oracle, FR-118 rule applied to FR-126)
//   4. rate limit per restaurant (after the signature)
//   5. parse JSON and the event (422)
//   6. find the row: `external_id = data.invoice.id`, else `id = data.invoice.reference`
//      (Marmitop sends `order_invoices.id` as the reference, so a webhook that beats the
//      worker's write of `external_id` still lands). Unknown: 200 and an audit row
//   7. apply: `invoice.*` sets the status (idempotent, FR-136) and, for rejected, denied, and
//      failed, queues a poll to fetch the error the body does not carry; `event.*` queues a
//      poll and trusts nothing in the body (06.api-spec.md)

import { randomBytes } from "node:crypto";

import {
  AppError,
  type ErrorBody,
  MAX_WEBHOOK_BODY_BYTES,
  type NfWebhookEvent,
  nfWebhookStatus,
  parseNfWebhookEvent,
  verifyNfSignature,
} from "@mt/core";
import { type Tx, withRestaurantContext } from "@mt/db";

import { toDbContext } from "../../context";
import type { ServiceDeps } from "../../deps";
import { mapError } from "../../errors";
import { writeAudit } from "../admin/internal";
import { systemCtx } from "../whatsapp/connection";
import { hitRateCounter, type RateDecision, WEBHOOK_RATE_LIMIT_PER_MINUTE } from "../whatsapp/inbound-webhook";
import { applyInvoiceUpdate, enqueueInvoiceJob, loadFiscalWebhookSecret } from "./shared";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Verified against when the restaurant has no secret, so the work matches a real check. */
const DUMMY_SECRET = randomBytes(32).toString("hex");

export type WebNfApplyResult =
  | { readonly action: "unknown_invoice" }
  | { readonly action: "applied"; readonly changed: boolean; readonly refreshQueued: boolean }
  | { readonly action: "ignored" };

export interface WebNfInboundStore {
  /** The unsealed webhook secret, or null: unknown restaurant, no fiscal integration, or disconnected. */
  loadSecret(restaurantId: string): Promise<string | null>;
  hit(restaurantId: string, now: Date): Promise<RateDecision>;
  apply(restaurantId: string, event: NfWebhookEvent): Promise<WebNfApplyResult>;
}

export interface WebNfWebhookReply {
  readonly status: number;
  readonly body: ErrorBody | { readonly received: true };
  readonly headers?: Readonly<Record<string, string>>;
  /** Set for a 5xx: the caller logs it. Never sent to the client. */
  readonly cause?: unknown;
}

export interface ReceiveWebNfInput {
  readonly restaurantId: string;
  readonly signatureHeader: string | null | undefined;
  readonly rawBody: Uint8Array;
  readonly now: Date;
}

function reply(error: AppError, headers?: Record<string, string>): WebNfWebhookReply {
  return { status: error.httpStatus, body: error.toErrorBody(), ...(headers ? { headers } : {}) };
}

const SIGNATURE_INVALID = () => new AppError("signature_invalid", "Webhook signature is invalid.");

export async function receiveWebNfWebhook(
  store: WebNfInboundStore,
  input: ReceiveWebNfInput,
): Promise<WebNfWebhookReply> {
  if (input.rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES) {
    return reply(new AppError("signature_invalid", "Webhook signature is invalid.", { httpStatus: 413 }));
  }
  try {
    const secret = UUID.test(input.restaurantId) ? await store.loadSecret(input.restaurantId) : null;
    const check = verifyNfSignature({
      headers: { "X-NF-Signature": input.signatureHeader ?? undefined },
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
    const event = parseNfWebhookEvent(json);
    await store.apply(input.restaurantId, event);
    return { status: 200, body: { received: true } };
  } catch (error) {
    const mapped = mapError(error);
    return { status: mapped.status, body: mapped.body, ...(mapped.unexpected ? { cause: error } : {}) };
  }
}

/** Step 6 and 7 inside one transaction under the restaurant's `system` context. */
export async function applyWebNfEvent(
  tx: Tx,
  restaurantId: string,
  event: NfWebhookEvent,
  now: Date = new Date(),
): Promise<WebNfApplyResult> {
  const isInvoice = event.type.startsWith("invoice.");
  const isEvent = event.type.startsWith("event.");
  if (!isInvoice && !isEvent) return { action: "ignored" };

  const [byExternal] = await tx<{ id: string }[]>`
    select id from public.order_invoices where restaurant_id = ${restaurantId} and external_id = ${event.invoice.id}
  `;
  let id = byExternal?.id;
  if (id === undefined && event.invoice.reference && UUID.test(event.invoice.reference)) {
    const [byRef] = await tx<{ id: string }[]>`
      update public.order_invoices set external_id = ${event.invoice.id}
      where restaurant_id = ${restaurantId} and id = ${event.invoice.reference} and external_id is null
      returning id
    `;
    id = byRef?.id;
  }
  if (id === undefined) {
    // 200, no retry storm; the audit row is the trace (06.api-spec.md).
    await writeAudit(tx, systemCtx(restaurantId), {
      action: "invoice.webhook_unknown",
      entityType: "order_invoice",
      entityId: null,
      context: { type: event.type, external_id: event.invoice.id.slice(0, 64) },
    });
    return { action: "unknown_invoice" };
  }

  if (isEvent) {
    await enqueueInvoiceJob(tx, restaurantId, id, "poll");
    return { action: "applied", changed: false, refreshQueued: true };
  }
  const status = nfWebhookStatus(event.type);
  if (status === null) return { action: "ignored" };
  const result = await applyInvoiceUpdate(
    tx,
    restaurantId,
    id,
    {
      status,
      numero: event.invoice.numero,
      chaveAcesso: event.invoice.chaveAcesso,
    },
    now,
  );
  // The body carries no error and no serie: a poll reads them. Only when the status moved,
  // so a replayed delivery queues nothing new (FR-136).
  const needsRead = result.changed && result.status !== null && result.status !== "cancelled";
  if (needsRead) await enqueueInvoiceJob(tx, restaurantId, id, "poll");
  return { action: "applied", changed: result.changed, refreshQueued: needsRead };
}

/** The production store. */
export function createDbWebNfInboundStore(deps: ServiceDeps): WebNfInboundStore {
  const inContext = <T>(restaurantId: string, fn: (tx: Tx) => Promise<T>) =>
    withRestaurantContext(deps.db, toDbContext(systemCtx(restaurantId)), fn, deps.contextOptions);
  return {
    loadSecret: (restaurantId) => inContext(restaurantId, (tx) => loadFiscalWebhookSecret(tx, deps, restaurantId)),
    hit: (restaurantId, now) => hitRateCounter(deps.db, restaurantId, "webhook", WEBHOOK_RATE_LIMIT_PER_MINUTE, now),
    apply: (restaurantId, event) =>
      inContext(restaurantId, (tx) => applyWebNfEvent(tx, restaurantId, event, deps.clock.now())),
  };
}
