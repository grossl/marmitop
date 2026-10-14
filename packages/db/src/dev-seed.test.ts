// packages/db/src/dev-seed.test.ts
//
// covers FR-009, NFR-010
//
// Unit tests for the local-stack tooling in scripts/ (11.operations.md "Local
// development"). They live here because scripts/ is not a workspace; this
// package's test run is where they execute.
//   * supabase/seed.sql matches its generator (no hand edits, no drift);
//   * the seed's envelope layout follows 07.security.md and round-trips;
//   * scripts/local-dev.ts maps `supabase status` to the env names in
//     04.architecture.md "Configuration".

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { EnvelopeSecretBox, parseKek } from "@mt/core";
import { DEV_KEK_BASE64, RESTAURANTS, SECRET_LIST, USER_LIST } from "../../../scripts/dev-seed/constants";
import { open, sealDeterministic } from "../../../scripts/dev-seed/envelope";
import { OUTPUT, renderSeed, seedCounts } from "../../../scripts/dev-seed/generate";
import { buildEnvFiles, extractStackEnv } from "../../../scripts/local-dev";

describe("seed generator", () => {
  test("supabase/seed.sql is exactly what the generator writes (run `bun run seed:generate`)", () => {
    expect(readFileSync(OUTPUT, "utf8") === renderSeed()).toBe(true);
  });

  test("two restaurants, each with one admin and one attendant (FR-009)", () => {
    for (const restaurant of Object.values(RESTAURANTS)) {
      const roles = USER_LIST.filter((u) => u.restaurant.id === restaurant.id).map((u) => u.role);
      expect(roles.sort()).toEqual(["admin", "attendant"]);
    }
  });

  test("the demo restaurant has six months of orders and today's board", () => {
    const counts = seedCounts()[RESTAURANTS.casa.id];
    expect(counts?.orders).toBeGreaterThan(900);
    expect(counts?.customers).toBeGreaterThanOrEqual(8);
    expect(counts?.menu_item_sizes).toBeGreaterThan(0);
  });
});

describe("seed envelope (07.security.md, ADR-012)", () => {
  test("every seeded secret round-trips under the dev MT_KEK", () => {
    for (const s of SECRET_LIST) {
      const sealed = sealDeterministic(DEV_KEK_BASE64, s.restaurant.id, s.id, s.kind, s.plaintext);
      expect(open(DEV_KEK_BASE64, s.restaurant.id, s.id, s.kind, sealed)).toBe(s.plaintext);
    }
  });

  test("packages/core EnvelopeSecretBox opens every seeded secret (one format, two writers)", async () => {
    const box = new EnvelopeSecretBox({ kek: parseKek(DEV_KEK_BASE64) });
    for (const s of SECRET_LIST) {
      const sealed = sealDeterministic(DEV_KEK_BASE64, s.restaurant.id, s.id, s.kind, s.plaintext);
      const context = { restaurantId: s.restaurant.id, secretId: s.id, kind: s.kind };
      expect(await box.open({ ...sealed, kekVersion: 1 }, context)).toBe(s.plaintext);
    }
  });

  test("layout: 12-byte iv, ciphertext with a 16-byte tag, wrapped key = iv(12) + key(32) + tag(16)", () => {
    const s = SECRET_LIST[0];
    if (s === undefined) throw new Error("no secret");
    const sealed = sealDeterministic(DEV_KEK_BASE64, s.restaurant.id, s.id, s.kind, s.plaintext);
    expect(sealed.iv.length).toBe(12);
    expect(sealed.ciphertext.length).toBe(Buffer.byteLength(s.plaintext) + 16);
    expect(sealed.wrappedKey.length).toBe(12 + 32 + 16);
    expect(sealed.last4).toBe(s.plaintext.slice(-4));
  });

  test("the AAD binds a ciphertext to its row: another restaurant id fails the tag check", () => {
    const s = SECRET_LIST[0];
    if (s === undefined) throw new Error("no secret");
    const sealed = sealDeterministic(DEV_KEK_BASE64, s.restaurant.id, s.id, s.kind, s.plaintext);
    expect(() => open(DEV_KEK_BASE64, RESTAURANTS.minas.id, s.id, s.kind, sealed)).toThrow();
  });
});

describe("scripts/local-dev.ts env files", () => {
  const env = extractStackEnv({
    API_URL: "http://127.0.0.1:54421",
    ANON_KEY: "anon",
    JWT_SECRET: "jwt",
    SERVICE_ROLE_KEY: "never-used",
  });

  test("reads the stack values and refuses a status without them", () => {
    expect(env).toEqual({ apiUrl: "http://127.0.0.1:54421", anonKey: "anon", jwtSecret: "jwt" });
    expect(() => extractStackEnv({ API_URL: "x" })).toThrow("ANON_KEY");
  });

  test("writes the 04.architecture.md variables per app, and never the service role key", () => {
    const files = buildEnvFiles(env, '{"keys":[]}');
    const names = (path: string) =>
      (files.find((f) => f.relPath.endsWith(path))?.lines ?? []).map((line) => line.split("=")[0]).sort();
    expect(names(".env.local")).toEqual(
      [
        "DATABASE_URL",
        "MT_ALLOW_PRIVATE_HOSTS",
        "MT_ENV",
        "MT_KEK",
        "MT_LOG_LEVEL",
        "MT_PUBLIC_URL",
        "MT_UATIS_FAKE",
        "MT_WEBNF_FAKE",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "NEXT_PUBLIC_SUPABASE_URL",
        "PORT",
        "SUPABASE_JWT_JWKS",
        "SUPABASE_JWT_SECRET",
        "SUPABASE_URL",
      ].sort(),
    );
    expect(names("api/.env")).toContain("SUPABASE_JWT_JWKS");
    expect(names("worker/.env")).toEqual(
      [
        "DATABASE_URL",
        "MT_ALLOW_PRIVATE_HOSTS",
        "MT_ENV",
        "MT_KEK",
        "MT_LOG_LEVEL",
        "MT_UATIS_FAKE",
        "MT_WEBNF_FAKE",
        "MT_WORKER_CONCURRENCY",
        "SUPABASE_URL",
        "WORKER_HEALTH_PORT",
      ].sort(),
    );
    const all = files.flatMap((f) => f.lines).join("\n");
    expect(all).not.toContain("never-used");
    expect(all).toContain("DATABASE_URL=postgresql://app_service:");
    // No NEXT_PUBLIC_ name carries a secret (07.security.md).
    const publicNames = files
      .flatMap((f) => f.lines)
      .map((l) => l.split("=")[0] ?? "")
      .filter((n) => n.startsWith("NEXT_PUBLIC_"));
    expect(
      publicNames.filter(
        (n) => /KEK|SECRET|DATABASE/.test(n) || (/KEY/.test(n) && n !== "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      ),
    ).toEqual([]);
  });
});
