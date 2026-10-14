// covers FR-140, FR-141, 07.security.md "API keys" (steps 1-6, same 401 for unknown and revoked)
import { describe, expect, test } from "bun:test";
import { AppError, generateApiKey, hashApiKey } from "@mt/core";

import { type ApiKeyDirectory, type ApiKeyRecord, authenticateApiKey } from "./api-keys";

const R = "3f6c1a0e-7a3b-4b1e-9c53-1f3f6d0f6a11";
const live = generateApiKey("live");
const revoked = generateApiKey("test");

class MemoryDirectory implements ApiKeyDirectory {
  lookups: string[] = [];
  touched: string[] = [];
  rows = new Map<string, ApiKeyRecord>([
    [live.hash, { id: "k-live", restaurantId: R, environment: "live", revokedAt: null }],
    [revoked.hash, { id: "k-old", restaurantId: R, environment: "test", revokedAt: new Date() }],
  ]);
  async lookup(hash: string) {
    this.lookups.push(hash);
    return this.rows.get(hash) ?? null;
  }
  async touch(ctx: { apiKeyId: string }) {
    this.touched.push(ctx.apiKeyId);
  }
}

async function refusal(dir: ApiKeyDirectory, header: string | undefined) {
  const e = await authenticateApiKey(dir, header).catch((x) => x);
  expect(e).toBeInstanceOf(AppError);
  return (e as AppError).toErrorBody();
}

describe("authenticateApiKey", () => {
  test("a live key resolves to its restaurant as an attendant api_key actor and touches last_used_at", async () => {
    const dir = new MemoryDirectory();
    const ctx = await authenticateApiKey(dir, `Bearer ${live.key}`);
    expect(ctx).toEqual({
      actorType: "api_key",
      apiKeyId: "k-live",
      restaurantId: R,
      role: "attendant",
      environment: "live",
    });
    expect(dir.lookups).toEqual([hashApiKey(live.key)]);
    expect(dir.touched).toEqual(["k-live"]);
  });

  test("a missing header or a non-mtk token is 401 before any lookup", async () => {
    const dir = new MemoryDirectory();
    for (const h of [undefined, "", "Basic abc", "Bearer sk_live_123", `Bearer ${live.key}x`]) {
      expect((await refusal(dir, h)).error.code).toBe("unauthorized");
    }
    expect(dir.lookups).toEqual([]);
  });

  test("an unknown key and a revoked key get the same 401 body", async () => {
    const dir = new MemoryDirectory();
    const unknown = await refusal(dir, `Bearer ${generateApiKey("live").key}`);
    const old = await refusal(dir, `Bearer ${revoked.key}`);
    expect(unknown).toEqual(old);
    expect(unknown.error.code).toBe("unauthorized");
    expect(dir.touched).toEqual([]);
  });

  test("a failed touch does not refuse the request", async () => {
    const dir = new MemoryDirectory();
    dir.touch = async () => {
      throw new Error("db down");
    };
    const ctx = await authenticateApiKey(dir, `Bearer ${live.key}`);
    expect(ctx.apiKeyId).toBe("k-live");
  });
});
