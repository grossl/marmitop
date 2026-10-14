// covers FR-088, FR-089, FR-140, FR-141, NFR-012

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  extractBearerToken,
  generateApiKey,
  generateWebhookSecret,
  hashApiKey,
  parseApiKey,
  randomBase62,
} from "./api-keys";

const constantRng = (byte: number) => (n: number) => new Uint8Array(n).fill(byte);

describe("randomBase62", () => {
  test("maps bytes onto 0-9A-Za-z and rejects the biased tail (>= 248)", () => {
    expect(randomBase62(4, constantRng(0))).toBe("0000");
    expect(randomBase62(2, constantRng(61))).toBe("zz");
    expect(randomBase62(2, constantRng(62))).toBe("00"); // 62 % 62
    // 255 and 248 are rejected, so the sampler must ask again; feed a sequence
    const seq = [255, 248, 10, 11];
    let i = 0;
    const rng = (n: number) => {
      const out = new Uint8Array(n);
      for (let k = 0; k < n; k++) out[k] = seq[i++ % seq.length] as number;
      return out;
    };
    expect(randomBase62(2, rng)).toBe("AB"); // 10 -> 'A', 11 -> 'B'
  });
  test("system randomness gives the requested length and only base62", () => {
    const s = randomBase62(200);
    expect(s).toMatch(/^[0-9A-Za-z]{200}$/);
  });
});

describe("generateApiKey (ADR-009)", () => {
  test("live and test formats", () => {
    const live = generateApiKey("live");
    const test_ = generateApiKey("test");
    expect(live.key).toMatch(/^mtk_live_[0-9A-Za-z]{32}$/);
    expect(test_.key).toMatch(/^mtk_test_[0-9A-Za-z]{32}$/);
    expect(live.environment).toBe("live");
  });
  test("prefix is mtk_<env>_ plus the first 8 random characters; hash is hex sha-256 of the full key", () => {
    const k = generateApiKey("live", constantRng(1));
    expect(k.key).toBe(`mtk_live_${"1".repeat(32)}`);
    expect(k.prefix).toBe(`mtk_live_${"1".repeat(8)}`);
    expect(k.hash).toBe(createHash("sha256").update(k.key).digest("hex"));
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
  });
  test("two keys differ, and the prefix never reveals the whole key", () => {
    const a = generateApiKey("live");
    const b = generateApiKey("live");
    expect(a.key).not.toBe(b.key);
    expect(a.prefix.length).toBeLessThan(a.key.length);
  });
  test("hashApiKey is deterministic", () => {
    expect(hashApiKey("mtk_live_abc")).toBe(hashApiKey("mtk_live_abc"));
    expect(hashApiKey("mtk_live_abc")).not.toBe(hashApiKey("mtk_live_abd"));
  });
});

describe("parseApiKey / extractBearerToken (FR-140)", () => {
  const good = `mtk_live_${"a".repeat(32)}`;
  test("accepts well-formed keys and reports the environment", () => {
    expect(parseApiKey(good)).toEqual({ environment: "live" });
    expect(parseApiKey(`mtk_test_${"Z9".repeat(16)}`)).toEqual({ environment: "test" });
  });
  test("rejects other prefixes, wrong length, bad characters", () => {
    for (const bad of [
      `obk_live_${"a".repeat(32)}`,
      `mtk_prod_${"a".repeat(32)}`,
      `mtk_live_${"a".repeat(31)}`,
      `mtk_live_${"a".repeat(33)}`,
      `mtk_live_${"a".repeat(31)}-`,
      "",
      "mtk_live_",
    ]) {
      expect(parseApiKey(bad)).toBeNull();
    }
  });
  test("extracts a bearer token", () => {
    expect(extractBearerToken(`Bearer ${good}`)).toBe(good);
    expect(extractBearerToken(`bearer ${good}`)).toBe(good);
    expect(extractBearerToken(good)).toBeNull();
    expect(extractBearerToken(`Basic ${good}`)).toBeNull();
    expect(extractBearerToken(`Bearer ${good} extra`)).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken("Bearer ")).toBeNull();
  });
});

describe("generateWebhookSecret (FR-088)", () => {
  test("is 43 base62 characters (about 256 bits)", () => {
    const s = generateWebhookSecret();
    expect(s).toMatch(/^[0-9A-Za-z]{43}$/);
    expect(generateWebhookSecret()).not.toBe(s);
  });
});
