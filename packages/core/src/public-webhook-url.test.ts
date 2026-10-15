// covers FR-172 (ADR-021): MT_PUBLIC_URL must be a public https URL on port 443.
import { describe, expect, test } from "bun:test";

import { checkPublicBaseUrl, type PublicUrlRejection, uatisWebhookTargetUrl } from "./ssrf";

describe("checkPublicBaseUrl", () => {
  test("accepts a public https host and drops a trailing slash", () => {
    expect(checkPublicBaseUrl("https://abc-def.trycloudflare.com/")).toEqual({
      ok: true,
      url: "https://abc-def.trycloudflare.com",
    });
  });

  test("keeps a path prefix", () => {
    expect(checkPublicBaseUrl("https://api.marmitop.com.br/mt")).toEqual({
      ok: true,
      url: "https://api.marmitop.com.br/mt",
    });
  });

  test("accepts an explicit :443", () => {
    expect(checkPublicBaseUrl("https://api.marmitop.com.br:443").ok).toBe(true);
  });

  test.each<[string | undefined, PublicUrlRejection]>([
    [undefined, "missing"],
    ["", "missing"],
    ["not a url", "invalid_url"],
    ["http://api.marmitop.com.br", "not_https"],
    ["http://localhost:3101", "not_https"],
    ["https://localhost", "private_host"],
    ["https://app.localhost", "private_host"],
    ["https://127.0.0.1", "private_host"],
    ["https://10.0.0.5", "private_host"],
    ["https://192.168.1.10", "private_host"],
    ["https://[::1]", "private_host"],
    ["https://box.internal", "private_host"],
    ["https://x.example.com:8443", "port_not_allowed"],
    ["https://user:pw@x.example.com", "userinfo_not_allowed"],
    ["https://x.example.com/?a=1", "query_not_allowed"],
    ["https://x.example.com/#a", "query_not_allowed"],
  ])("refuses %p (%s)", (input, reason) => {
    expect(checkPublicBaseUrl(input)).toEqual({ ok: false, reason });
  });
});

describe("uatisWebhookTargetUrl", () => {
  test("appends the inbound route and the restaurant id", () => {
    expect(uatisWebhookTargetUrl("https://api.example.com/mt", "11111111-1111-4111-8111-111111111111")).toBe(
      "https://api.example.com/mt/v1/webhooks/uatis/11111111-1111-4111-8111-111111111111",
    );
  });
});
