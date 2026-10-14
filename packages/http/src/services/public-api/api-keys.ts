// API-key authentication for the public API (FR-140, FR-141; ADR-009, ADR-017;
// 07.security.md "API keys"):
//
//   1. `Authorization: Bearer mtk_(live|test)_<32 base62>`; anything else is 401 before any database work
//   2. SHA-256 the key, `mt.api_key_lookup(hash)`: the only lookup before a restaurant context exists
//   3. no row or `revoked_at` set: the same 401 body
//   4. the context: actor `api_key`, role `attendant`
//   5. `mt.touch_api_key` (at most one write per minute per key); a failure never refuses the request
//
// The directory is a port: `createDbApiKeyDirectory` in production, a memory one in tests.

import { type ApiKeyEnvironment, AppError, extractBearerToken, hashApiKey, parseApiKey } from "@mt/core";
import { withoutContext, withRestaurantContext } from "@mt/db";

import { type ApiKeyContext, toDbContext } from "../../context";
import type { ServiceDeps } from "../../deps";

export interface ApiKeyRecord {
  readonly id: string;
  readonly restaurantId: string;
  readonly environment: ApiKeyEnvironment;
  readonly revokedAt: Date | null;
}

export interface ApiKeyDirectory {
  lookup(hash: string): Promise<ApiKeyRecord | null>;
  touch(ctx: ApiKeyContext): Promise<void>;
}

export interface AuthenticatedApiKey extends ApiKeyContext {
  /** `live` or `test`. Both reach the same data and gateways (ADR-017); recorded for audit. */
  readonly environment: ApiKeyEnvironment;
}

const UNAUTHORIZED = () => new AppError("unauthorized", "Missing or invalid API key.");

export async function authenticateApiKey(
  directory: ApiKeyDirectory,
  authorization: string | null | undefined,
): Promise<AuthenticatedApiKey> {
  const token = extractBearerToken(authorization);
  if (token === null || parseApiKey(token) === null) throw UNAUTHORIZED();
  const record = await directory.lookup(hashApiKey(token));
  if (record === null || record.revokedAt !== null) throw UNAUTHORIZED();
  const ctx: AuthenticatedApiKey = {
    actorType: "api_key",
    apiKeyId: record.id,
    restaurantId: record.restaurantId,
    role: "attendant",
    environment: record.environment,
  };
  try {
    await directory.touch(ctx);
  } catch {
    // `last_used_at` is informational (FR-089); a failed write must not refuse a valid key.
  }
  return ctx;
}

export function createDbApiKeyDirectory(deps: ServiceDeps): ApiKeyDirectory {
  return {
    async lookup(hash) {
      const [row] = await withoutContext(
        deps.db,
        (tx) =>
          tx<{ id: string; restaurant_id: string; environment: ApiKeyEnvironment; revoked_at: Date | null }[]>`
            select id, restaurant_id, environment, revoked_at from mt.api_key_lookup(${hash})
          `,
        "app_service",
      );
      return row === undefined
        ? null
        : { id: row.id, restaurantId: row.restaurant_id, environment: row.environment, revokedAt: row.revoked_at };
    },
    async touch(ctx) {
      await withRestaurantContext(
        deps.db,
        toDbContext(ctx),
        (tx) => tx`select mt.touch_api_key(${ctx.apiKeyId}::uuid)`,
        deps.contextOptions,
      );
    },
  };
}
