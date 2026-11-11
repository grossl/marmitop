import { describe, expect, test } from "bun:test";

import { buildCsp, createNonce } from "./csp";

// covers 07.security.md "Transport"
describe("buildCsp", () => {
  const prod = buildCsp({ nonce: "abc", supabaseUrl: "https://ref.supabase.co", dev: false });

  test("scripts run only with the nonce, and nothing can frame the page", () => {
    expect(prod).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(prod).not.toContain("unsafe-eval");
    expect(prod).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("upgrade-insecure-requests");
  });

  test("allows the Supabase project for images, Auth, and Realtime", () => {
    expect(prod).toContain("img-src 'self' data: blob: https://ref.supabase.co");
    expect(prod).toContain("connect-src 'self' https://ref.supabase.co wss://ref.supabase.co");
  });

  test("development allows eval and the HMR websocket, and a local http Supabase", () => {
    const dev = buildCsp({ nonce: "n", supabaseUrl: "http://127.0.0.1:54421", dev: true });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain("connect-src 'self' http://127.0.0.1:54421 ws://127.0.0.1:54421 ws:");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });

  test("a missing or malformed Supabase URL adds no origin", () => {
    for (const supabaseUrl of [undefined, "not a url"]) {
      expect(buildCsp({ nonce: "n", supabaseUrl, dev: false })).toContain("connect-src 'self'; ");
    }
  });
});

describe("createNonce", () => {
  test("is fresh base64 of 16 bytes", () => {
    const a = createNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(createNonce()).not.toBe(a);
  });
});
