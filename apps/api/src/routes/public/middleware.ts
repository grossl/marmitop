// The public API chain (06.api-spec.md; 07.security.md "API keys"), per route group:
//
//   apiKeyAuth   Bearer mtk_* → hash → mt.api_key_lookup → ctx (api_key, attendant); 401 otherwise
//   rateLimit    per key, read 600/min, write 120/min; X-RateLimit-* on every answer; 429 + Retry-After
//   idempotency  POST only, with Idempotency-Key: replay, 409 on another body, store 2xx answers
//
// Every refusal uses the error envelope with `details: []` at least. The API key never
// reaches a log line (NFR-011).

import {
  type AuthenticatedApiKey,
  authenticateApiKey,
  decideIdempotency,
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_REPLAYED_HEADER,
  idempotencyRequestHash,
  type PublicApiBackend,
  parseIdempotencyKey,
  rateClassFor,
  rateLimitHeaders,
  toWireError,
} from "@mt/http";
import { AppError } from "@mt/core";
import { parseOrThrow } from "@mt/schemas";
import type { Context, MiddlewareHandler } from "hono";
import type { ZodTypeAny, z } from "zod";

import type { ApiDeps } from "../../http/types";

export type PublicEnv = { Variables: { apiKey: AuthenticatedApiKey } };
export type PublicContext = Context<PublicEnv>;

/** Renders any error as the public envelope; logs only unexpected ones, without the message reaching the client. */
export function respondError(c: Context, deps: ApiDeps, error: unknown): Response {
  const wire = toWireError(error);
  if (wire.unexpected) {
    deps.log.error("public api error", { path: c.req.path, error: (error as Error)?.message ?? "unknown" });
  }
  return c.json(wire.body, wire.status as 400);
}

export function apiKeyAuth(deps: ApiDeps, backend: PublicApiBackend): MiddlewareHandler<PublicEnv> {
  return async (c, next) => {
    let apiKey: AuthenticatedApiKey;
    try {
      apiKey = await authenticateApiKey(backend.keys, c.req.header("Authorization"));
    } catch (error) {
      if (!(error instanceof AppError)) return respondError(c, deps, error);
      deps.log.warn("api key refused", { path: c.req.path });
      return respondError(c, deps, error);
    }
    c.set("apiKey", apiKey);
    await next();
  };
}

export function rateLimit(deps: ApiDeps, backend: PublicApiBackend): MiddlewareHandler<PublicEnv> {
  return async (c, next) => {
    const apiKey = c.get("apiKey");
    let decision: Awaited<ReturnType<PublicApiBackend["rateLimiter"]["hit"]>>;
    try {
      decision = await backend.rateLimiter.hit(apiKey.apiKeyId, rateClassFor(c.req.method), deps.clock.now());
    } catch (error) {
      return respondError(c, deps, error);
    }
    for (const [k, v] of Object.entries(rateLimitHeaders(decision))) c.header(k, v);
    if (!decision.allowed) {
      c.header("Retry-After", String(decision.retryAfterSeconds));
      return respondError(c, deps, new AppError("rate_limited", "Too many requests for this API key."));
    }
    await next();
  };
}

export function idempotency(deps: ApiDeps, backend: PublicApiBackend): MiddlewareHandler<PublicEnv> {
  return async (c, next) => {
    if (c.req.method !== "POST") return next();
    const apiKey = c.get("apiKey");
    let key: string | null;
    try {
      key = parseIdempotencyKey(c.req.header(IDEMPOTENCY_HEADER));
    } catch (error) {
      return respondError(c, deps, error);
    }
    if (key === null) return next();

    // Claim the key before the request runs (its own transaction), so two concurrent
    // requests with one key cannot both run (06.api-spec.md "Idempotency").
    try {
      const requestHash = idempotencyRequestHash(c.req.method, c.req.path, await c.req.text());
      const claim = await backend.idempotency.claim(apiKey, key, requestHash);
      if (claim.kind === "existing") {
        const decision = decideIdempotency(claim.row, requestHash);
        if (decision.kind === "replay") {
          c.header(IDEMPOTENCY_REPLAYED_HEADER, "true");
          return c.json(decision.body as object, decision.status as 200);
        }
        if (decision.retryAfterSeconds !== undefined) c.header("Retry-After", String(decision.retryAfterSeconds));
        return respondError(c, deps, decision.error);
      }
    } catch (error) {
      return respondError(c, deps, error);
    }

    let completed = false; // true once the route answered 2xx
    try {
      // Route handlers answer errors themselves; a throw here is a bug and still releases the claim.
      await next();
      if (c.res.status >= 200 && c.res.status < 300) {
        // The write happened: never release from here on. If storing the response fails,
        // the claim stays in progress and is taken over after 60 s.
        completed = true;
        const body = await c.res.clone().json();
        await backend.idempotency.complete(apiKey, key, { status: c.res.status, body });
      }
    } catch (error) {
      deps.log.error("idempotency record not completed", { error: (error as Error)?.message ?? "unknown" });
    } finally {
      if (!completed) {
        await backend.idempotency.release(apiKey, key).catch((error: unknown) => {
          // A claim left behind is taken over after 60 s.
          deps.log.error("idempotency claim not released", { error: (error as Error)?.message ?? "unknown" });
        });
      }
    }
  };
}

/** Parses the JSON body, then validates it with the route's snake_case schema (422 with body paths). */
export async function readBody<S extends ZodTypeAny>(c: PublicContext, schema: S): Promise<z.input<S>> {
  const text = await c.req.text();
  let json: unknown;
  try {
    json = text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    throw new AppError("validation_failed", "The request body is not valid JSON.");
  }
  parseOrThrow(schema, json);
  return json as z.input<S>;
}

export function readQuery<S extends ZodTypeAny>(c: PublicContext, schema: S): z.input<S> {
  const query = c.req.query();
  parseOrThrow(schema, query);
  return query as z.input<S>;
}

/** Runs a handler and turns any throw into the public envelope. */
export function handle(
  deps: ApiDeps,
  fn: (c: PublicContext) => Promise<Response>,
): (c: PublicContext) => Promise<Response> {
  return async (c) => {
    try {
      return await fn(c);
    } catch (error) {
      return respondError(c, deps, error);
    }
  };
}
