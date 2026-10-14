// API keys and generated secrets (ADR-009, ADR-017; FR-088, FR-089, FR-140, FR-141).
// Format: mtk_live_<32 base62> or mtk_test_<32 base62>. Only the SHA-256 hash and a display
// prefix are stored. A fast unsalted hash is right: the key is random, so no dictionary applies.

import { createHash, randomBytes } from "node:crypto";

export type ApiKeyEnvironment = "live" | "test";

export type RandomBytes = (n: number) => Uint8Array;

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
// 248 = 4 x 62. Bytes at or above it are dropped so every character is equally likely.
const LIMIT = 248;

const systemRandom: RandomBytes = (n) => new Uint8Array(randomBytes(n));

/** `length` base62 characters by rejection sampling over random bytes. */
export function randomBase62(length: number, rng: RandomBytes = systemRandom): string {
  let out = "";
  while (out.length < length) {
    const bytes = rng(length - out.length);
    for (const b of bytes) {
      if (b < LIMIT && out.length < length) out += ALPHABET[b % 62];
    }
  }
  return out;
}

export interface GeneratedApiKey {
  /** Shown once, never stored. */
  readonly key: string;
  /** `mtk_<env>_` plus the first 8 random characters. Safe to display and store. */
  readonly prefix: string;
  /** Hex SHA-256 of `key`. Unique across the platform. */
  readonly hash: string;
  readonly environment: ApiKeyEnvironment;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(environment: ApiKeyEnvironment, rng: RandomBytes = systemRandom): GeneratedApiKey {
  const head = `mtk_${environment}_`;
  const random = randomBase62(32, rng);
  const key = `${head}${random}`;
  return { key, prefix: `${head}${random.slice(0, 8)}`, hash: hashApiKey(key), environment };
}

const KEY_FORMAT = /^mtk_(live|test)_[0-9A-Za-z]{32}$/;

/** Format check before any database work (07.security.md). */
export function parseApiKey(value: string): { environment: ApiKeyEnvironment } | null {
  const m = KEY_FORMAT.exec(value);
  return m ? { environment: m[1] as ApiKeyEnvironment } : null;
}

export function extractBearerToken(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return m ? (m[1] as string) : null;
}

/** 07.security.md: 32 random bytes, base62. 43 characters carry about 256 bits. */
export function generateWebhookSecret(rng: RandomBytes = systemRandom): string {
  return randomBase62(43, rng);
}
