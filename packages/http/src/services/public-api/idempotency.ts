// Idempotency-Key for public POST routes (FR-145; 06.api-spec.md "Idempotency";
// 05.data-model.md "idempotency_records"; migration 0016).
//
// The key is claimed before the request runs, in its own short transaction:
//
//   insert ... status 'in_progress' on conflict do nothing returning
//     inserted                          → run the request
//     not inserted, claim stale (> 60 s) → take it over, run the request
//     not inserted, otherwise           → decide from the existing row:
//        completed + same hash  → replay, `Idempotency-Replayed: true`
//        another hash           → 409 idempotency_conflict
//        in progress, same hash → 409 idempotency_in_progress, Retry-After: 1
//
//   after the run: 2xx → store the response, mark completed
//                  anything else, or a throw → delete the claim (the client may retry)
//
// The hash covers the method, the path, and the raw body bytes. Keys are scoped per
// restaurant and trimmed after 30 days (`mt.trim_idempotency`).

import { createHash } from "node:crypto";

import { AppError } from "@mt/core";
import { withRestaurantContext } from "@mt/db";

import { type ApiKeyContext, toDbContext } from "../../context";
import type { ServiceDeps } from "../../deps";

export type IdempotencyRowStatus = "in_progress" | "completed";

export interface IdempotencyRow {
  readonly status: IdempotencyRowStatus;
  readonly requestHash: string;
  readonly responseStatus: number | null;
  readonly responseBody: unknown;
}

export type ClaimResult = { readonly kind: "claimed" } | { readonly kind: "existing"; readonly row: IdempotencyRow };

export interface IdempotencyStore {
  /** Claims the key atomically, taking over a claim older than 60 s. Otherwise returns the existing row. */
  claim(ctx: ApiKeyContext, key: string, requestHash: string): Promise<ClaimResult>;
  /** Stores the response of a claimed key and marks it completed. */
  complete(ctx: ApiKeyContext, key: string, response: { status: number; body: unknown }): Promise<void>;
  /** Deletes an in-progress claim, so the client can retry. */
  release(ctx: ApiKeyContext, key: string): Promise<void>;
}

export const IDEMPOTENCY_HEADER = "Idempotency-Key";
export const IDEMPOTENCY_REPLAYED_HEADER = "Idempotency-Replayed";
export const IDEMPOTENCY_STALE_AFTER_MS = 60_000;
const MAX_KEY_LENGTH = 255;

export function idempotencyRequestHash(method: string, path: string, rawBody: string): string {
  return createHash("sha256").update(`${method.toUpperCase()}\n${path}\n`).update(rawBody).digest("hex");
}

/** True when an in-progress claim made at `claimedAt` may be taken over. */
export function isStaleClaim(claimedAt: Date, now: Date): boolean {
  return now.getTime() - claimedAt.getTime() > IDEMPOTENCY_STALE_AFTER_MS;
}

export type IdempotencyDecision =
  | { readonly kind: "replay"; readonly status: number; readonly body: unknown }
  | { readonly kind: "refuse"; readonly error: AppError; readonly retryAfterSeconds?: number };

/** What to answer when the claim found an existing (not stale) row. */
export function decideIdempotency(existing: IdempotencyRow, requestHash: string): IdempotencyDecision {
  if (existing.requestHash !== requestHash) {
    return {
      kind: "refuse",
      error: new AppError("idempotency_conflict", "This Idempotency-Key was already used with another request body."),
    };
  }
  if (existing.status === "in_progress" || existing.responseStatus === null) {
    return {
      kind: "refuse",
      error: new AppError("idempotency_in_progress", "A request with this Idempotency-Key is still running."),
      retryAfterSeconds: 1,
    };
  }
  return { kind: "replay", status: existing.responseStatus, body: existing.responseBody };
}

/** Null when the header is absent. Empty or longer than 255 characters is 422. */
export function parseIdempotencyKey(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (value.length === 0 || value.length > MAX_KEY_LENGTH) {
    throw new AppError("validation_failed", "The Idempotency-Key header is invalid.", {
      details: [{ path: IDEMPOTENCY_HEADER, code: "invalid_length", message: "Use 1 to 255 characters." }],
    });
  }
  return value;
}

interface DbRow {
  status: IdempotencyRowStatus;
  request_hash: string;
  response_status: number | null;
  response_body: unknown;
}

export function createDbIdempotencyStore(deps: ServiceDeps): IdempotencyStore {
  const inContext = <T>(ctx: ApiKeyContext, fn: Parameters<typeof withRestaurantContext<T>>[2]) =>
    withRestaurantContext(deps.db, toDbContext(ctx), fn, deps.contextOptions);
  const staleSeconds = IDEMPOTENCY_STALE_AFTER_MS / 1000;
  return {
    claim: (ctx, key, requestHash) =>
      inContext(ctx, async (tx): Promise<ClaimResult> => {
        const inserted = await tx`
          insert into public.idempotency_records (restaurant_id, idempotency_key, request_hash, status)
          values (${ctx.restaurantId}, ${key}, ${requestHash}, 'in_progress')
          on conflict (restaurant_id, idempotency_key) do nothing
          returning idempotency_key
        `;
        if (inserted.length > 0) return { kind: "claimed" };
        // A claim whose request died, or a record past the 30-day expiry, is taken over.
        const taken = await tx`
          update public.idempotency_records
          set request_hash = ${requestHash}, status = 'in_progress', response_status = null,
              response_body = null, created_at = now()
          where restaurant_id = ${ctx.restaurantId} and idempotency_key = ${key}
            and ((status = 'in_progress' and created_at < now() - make_interval(secs => ${staleSeconds}))
                 or created_at < now() - interval '30 days')
          returning idempotency_key
        `;
        if (taken.length > 0) return { kind: "claimed" };
        const [row] = await tx<DbRow[]>`
          select status, request_hash, response_status, response_body from public.idempotency_records
          where restaurant_id = ${ctx.restaurantId} and idempotency_key = ${key}
        `;
        // Deleted between the insert and the read (released by its owner): the next try claims it.
        if (row === undefined) {
          return {
            kind: "existing",
            row: { status: "in_progress", requestHash, responseStatus: null, responseBody: null },
          };
        }
        return {
          kind: "existing",
          row: {
            status: row.status,
            requestHash: row.request_hash,
            responseStatus: row.response_status,
            responseBody: row.response_body,
          },
        };
      }),
    complete: async (ctx, key, response) => {
      await inContext(
        ctx,
        (tx) => tx`
          update public.idempotency_records
          set status = 'completed', response_status = ${response.status},
              response_body = ${JSON.stringify(response.body)}::text::jsonb
          where restaurant_id = ${ctx.restaurantId} and idempotency_key = ${key} and status = 'in_progress'
        `,
      );
    },
    release: async (ctx, key) => {
      await inContext(
        ctx,
        (tx) => tx`
          delete from public.idempotency_records
          where restaurant_id = ${ctx.restaurantId} and idempotency_key = ${key} and status = 'in_progress'
        `,
      );
    },
  };
}
