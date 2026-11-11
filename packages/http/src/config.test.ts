// covers NFR-011, FR-172, ADR-012, ADR-017 (gateway choice from deployment config only), ADR-041
import { describe, expect, test } from "bun:test";

import { readServerConfig } from "./config";

const KEK = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString("base64");
const PUBLIC = "https://api.example.com";

describe("readServerConfig", () => {
  test("reports every missing required variable", () => {
    const result = readServerConfig({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toEqual(["DATABASE_URL", "MT_KEK", "MT_PUBLIC_URL"]);
  });

  test("a KEK that does not decode to 32 bytes counts as missing", () => {
    const result = readServerConfig({ DATABASE_URL: "postgres://x", MT_KEK: "c2hvcnQ=", MT_PUBLIC_URL: PUBLIC });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toEqual(["MT_KEK"]);
  });

  test("parses the gateway flags, the environment, and the previous KEK", () => {
    const result = readServerConfig({
      DATABASE_URL: "postgres://x",
      MT_KEK: KEK,
      MT_KEK_PREVIOUS: KEK,
      MT_KEK_VERSION: "3",
      MT_UATIS_FAKE: "1",
      MT_WEBNF_FAKE: "0",
      MT_ENV: "development",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.kek.length).toBe(32);
    expect(result.config.kekPrevious?.length).toBe(32);
    expect(result.config.kekVersion).toBe(3);
    expect(result.config.uatisFake).toBe(true);
    expect(result.config.webnfFake).toBe(false);
    expect(result.config.env).toBe("development");
  });

  test("defaults to real gateways and the production environment", () => {
    const result = readServerConfig({ DATABASE_URL: "postgres://x", MT_KEK: KEK, MT_PUBLIC_URL: PUBLIC });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.uatisFake).toBe(false);
    expect(result.config.webnfFake).toBe(false);
    expect(result.config.env).toBe("production");
  });

  test("a previous KEK needs a current version of at least 2", () => {
    const result = readServerConfig({
      DATABASE_URL: "postgres://x",
      MT_KEK: KEK,
      MT_KEK_PREVIOUS: KEK,
      MT_PUBLIC_URL: PUBLIC,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toEqual(["MT_KEK_VERSION"]);
  });

  test("the missing list never echoes a value", () => {
    const result = readServerConfig({ DATABASE_URL: "postgres://user:secret@h/db", MT_KEK: "bad" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  test("MT_ALLOW_PRIVATE_HOSTS=1 turns the SSRF private-host check off outside production", () => {
    const result = readServerConfig({
      DATABASE_URL: "postgres://x",
      MT_KEK: KEK,
      MT_ENV: "development",
      MT_ALLOW_PRIVATE_HOSTS: "1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.allowPrivateHosts).toBe(true);
  });

  test("the SSRF guard is on by default", () => {
    const result = readServerConfig({ DATABASE_URL: "postgres://x", MT_KEK: KEK, MT_ENV: "development" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.allowPrivateHosts).toBe(false);
  });

  test("MT_ALLOW_PRIVATE_HOSTS in production is refused (ADR-017 #5)", () => {
    const result = readServerConfig({
      DATABASE_URL: "postgres://x",
      MT_KEK: KEK,
      MT_PUBLIC_URL: PUBLIC,
      MT_ALLOW_PRIVATE_HOSTS: "1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toEqual(["MT_ALLOW_PRIVATE_HOSTS"]);
  });

  test("MT_UATIS_FAKE and MT_WEBNF_FAKE in production are refused", () => {
    const base = { DATABASE_URL: "postgres://x", MT_KEK: KEK, MT_PUBLIC_URL: PUBLIC };
    const prod = readServerConfig({ ...base, MT_UATIS_FAKE: "1", MT_WEBNF_FAKE: "1" });
    expect(prod.ok ? [] : prod.missing).toEqual(["MT_UATIS_FAKE", "MT_WEBNF_FAKE"]);
    const dev = readServerConfig({ ...base, MT_ENV: "development", MT_UATIS_FAKE: "1", MT_WEBNF_FAKE: "1" });
    expect(dev.ok && dev.config.uatisFake && dev.config.webnfFake).toBe(true);
  });

  // covers FR-172 (ADR-021)
  test("reads MT_PUBLIC_URL as given, trimmed", () => {
    const base = { DATABASE_URL: "postgres://x", MT_KEK: KEK, MT_ENV: "development" };
    const a = readServerConfig({ ...base, MT_PUBLIC_URL: " https://api.example.com " });
    expect(a.ok && a.config.publicUrl).toBe("https://api.example.com");
    const b = readServerConfig(base);
    expect(b.ok && b.config.publicUrl).toBeUndefined();
  });

  // covers FR-172 (ADR-041): production always has a push target.
  test("production refuses an MT_PUBLIC_URL that fails FR-172; an unset MT_ENV counts as production", () => {
    const base = { DATABASE_URL: "postgres://x", MT_KEK: KEK };
    for (const url of [
      undefined,
      "",
      "http://api.example.com",
      "https://localhost",
      "https://10.0.0.5",
      "https://api.example.com:8443",
    ]) {
      const r = readServerConfig({ ...base, MT_PUBLIC_URL: url });
      expect(r.ok ? [] : r.missing).toEqual(["MT_PUBLIC_URL"]);
      const p = readServerConfig({ ...base, MT_ENV: "production", MT_PUBLIC_URL: url });
      expect(p.ok ? [] : p.missing).toEqual(["MT_PUBLIC_URL"]);
    }
    const ok = readServerConfig({ ...base, MT_PUBLIC_URL: PUBLIC });
    expect(ok.ok && ok.config.publicUrl).toBe(PUBLIC);
  });

  test("development and test accept any MT_PUBLIC_URL; the service checks it on Ativar webhook", () => {
    const base = { DATABASE_URL: "postgres://x", MT_KEK: KEK };
    for (const env of ["development", "test"]) {
      expect(readServerConfig({ ...base, MT_ENV: env }).ok).toBe(true);
      expect(readServerConfig({ ...base, MT_ENV: env, MT_PUBLIC_URL: "http://localhost:3101" }).ok).toBe(true);
    }
  });

  test("the worker opts out: requirePublicUrl false accepts a missing MT_PUBLIC_URL in production", () => {
    const r = readServerConfig({ DATABASE_URL: "postgres://x", MT_KEK: KEK }, { requirePublicUrl: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.env).toBe("production");
  });
});
