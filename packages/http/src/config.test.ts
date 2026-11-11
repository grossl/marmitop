// covers NFR-011, ADR-012, ADR-017 (gateway choice from deployment config only)
import { describe, expect, test } from "bun:test";

import { readServerConfig } from "./config";

const KEK = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString("base64");

describe("readServerConfig", () => {
  test("reports every missing required variable", () => {
    const result = readServerConfig({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toEqual(["DATABASE_URL", "MT_KEK"]);
  });

  test("a KEK that does not decode to 32 bytes counts as missing", () => {
    const result = readServerConfig({ DATABASE_URL: "postgres://x", MT_KEK: "c2hvcnQ=" });
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
    const result = readServerConfig({ DATABASE_URL: "postgres://x", MT_KEK: KEK });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.uatisFake).toBe(false);
    expect(result.config.webnfFake).toBe(false);
    expect(result.config.env).toBe("production");
  });

  test("a previous KEK needs a current version of at least 2", () => {
    const result = readServerConfig({ DATABASE_URL: "postgres://x", MT_KEK: KEK, MT_KEK_PREVIOUS: KEK });
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
    const result = readServerConfig({ DATABASE_URL: "postgres://x", MT_KEK: KEK, MT_ALLOW_PRIVATE_HOSTS: "1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toEqual(["MT_ALLOW_PRIVATE_HOSTS"]);
  });

  test("MT_UATIS_FAKE and MT_WEBNF_FAKE in production are refused", () => {
    const base = { DATABASE_URL: "postgres://x", MT_KEK: KEK };
    const prod = readServerConfig({ ...base, MT_UATIS_FAKE: "1", MT_WEBNF_FAKE: "1" });
    expect(prod.ok ? [] : prod.missing).toEqual(["MT_UATIS_FAKE", "MT_WEBNF_FAKE"]);
    const dev = readServerConfig({ ...base, MT_ENV: "development", MT_UATIS_FAKE: "1", MT_WEBNF_FAKE: "1" });
    expect(dev.ok && dev.config.uatisFake && dev.config.webnfFake).toBe(true);
  });

  // covers FR-172, FR-174 (ADR-021, ADR-023)
  test("reads MT_PUBLIC_URL as given and MT_UATIS_PULL_SECONDS with default 3", () => {
    const base = { DATABASE_URL: "postgres://x", MT_KEK: KEK };
    const a = readServerConfig({ ...base, MT_PUBLIC_URL: " https://api.example.com " });
    expect(a.ok && a.config.publicUrl).toBe("https://api.example.com");
    expect(a.ok && a.config.uatisPullSeconds).toBe(3);
    const b = readServerConfig({ ...base, MT_UATIS_PULL_SECONDS: "5" });
    expect(b.ok && b.config.publicUrl).toBeUndefined();
    expect(b.ok && b.config.uatisPullSeconds).toBe(5);
  });

  test("refuses an MT_UATIS_PULL_SECONDS outside 1..60", () => {
    for (const v of ["0", "61", "2.5", "x"]) {
      const r = readServerConfig({ DATABASE_URL: "postgres://x", MT_KEK: KEK, MT_UATIS_PULL_SECONDS: v });
      expect(r.ok ? [] : r.missing).toEqual(["MT_UATIS_PULL_SECONDS"]);
    }
  });
});
