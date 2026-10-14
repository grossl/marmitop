// covers FR-148, NFR-014
import { describe, expect, test } from "bun:test";
import { checkOutboundUrl, isBlockedAddress, isBlockedHostname } from "./ssrf";

describe("isBlockedAddress: IPv4", () => {
  const blocked = [
    "0.0.0.0",
    "0.1.2.3",
    "10.0.0.1",
    "10.255.255.255",
    "100.64.0.1",
    "100.127.255.255",
    "127.0.0.1",
    "127.255.255.254",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.8",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.255",
    "224.0.0.1",
    "239.255.255.255",
    "240.0.0.1",
    "255.255.255.255",
  ];
  const allowed = [
    "8.8.8.8",
    "1.1.1.1",
    "172.15.255.255",
    "172.32.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "198.17.0.1",
    "198.20.0.1",
    "11.0.0.1",
    "192.0.1.1",
    "193.168.0.1",
  ];
  for (const ip of blocked) test(`blocks ${ip}`, () => expect(isBlockedAddress(ip)).toBe(true));
  for (const ip of allowed) test(`allows ${ip}`, () => expect(isBlockedAddress(ip)).toBe(false));
});

describe("isBlockedAddress: IPv6", () => {
  test("blocks unspecified, loopback, unique local, link local, multicast", () => {
    for (const ip of ["::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "febf::1", "ff02::1", "0:0:0:0:0:0:0:1"]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });
  test("blocks IPv4-mapped addresses of blocked IPv4 ranges, in dotted and hex form", () => {
    for (const ip of [
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:10.0.0.1",
      "::ffff:a00:1",
      "::ffff:169.254.169.254",
      "::ffff:c0a8:101",
    ]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });
  test("allows an IPv4-mapped public address and public IPv6", () => {
    expect(isBlockedAddress("::ffff:8.8.8.8")).toBe(false);
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedAddress("2001:4860:4860::8888")).toBe(false);
  });
  test("blocks NAT64 and 6to4 forms that embed a private IPv4", () => {
    expect(isBlockedAddress("64:ff9b::7f00:1")).toBe(true);
    expect(isBlockedAddress("2002:7f00:1::")).toBe(true);
    expect(isBlockedAddress("64:ff9b::808:808")).toBe(false);
  });
  test("treats an unparseable address as blocked", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
  });
});

describe("isBlockedHostname", () => {
  test("blocks localhost names and internal suffixes", () => {
    for (const h of [
      "localhost",
      "LOCALHOST",
      "foo.localhost",
      "printer.local",
      "db.internal",
      "x.localdomain",
      "localhost.",
    ]) {
      expect(isBlockedHostname(h)).toBe(true);
    }
    expect(isBlockedHostname("example.com")).toBe(false);
    expect(isBlockedHostname("api.marmitop.com.br")).toBe(false);
  });
});

describe("checkOutboundUrl (production rules)", () => {
  const ok = (u: string) => checkOutboundUrl(u, { allowPrivateHosts: false });
  test("accepts a public https URL", () => {
    expect(ok("https://hooks.example.com/marmitop")).toEqual({ ok: true, url: "https://hooks.example.com/marmitop" });
  });
  test("rejects http, other schemes, user info, bad URLs", () => {
    expect(ok("http://hooks.example.com/x")).toMatchObject({ ok: false, reason: "scheme_not_allowed" });
    expect(ok("ftp://hooks.example.com/x")).toMatchObject({ ok: false, reason: "scheme_not_allowed" });
    expect(ok("https://user:pass@hooks.example.com/x")).toMatchObject({ ok: false, reason: "userinfo_not_allowed" });
    expect(ok("https://user@hooks.example.com/x")).toMatchObject({ ok: false, reason: "userinfo_not_allowed" });
    expect(ok("not a url")).toMatchObject({ ok: false, reason: "invalid_url" });
    expect(ok("")).toMatchObject({ ok: false, reason: "invalid_url" });
  });
  test("rejects private, loopback, and link-local hosts, including odd IPv4 spellings", () => {
    for (const u of [
      "https://127.0.0.1/x",
      "https://localhost/x",
      "https://10.1.2.3/x",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/x",
      "https://[::ffff:127.0.0.1]/x",
      "https://[fe80::1]/x",
      "https://2130706433/x", // decimal 127.0.0.1
      "https://0x7f.0.0.1/x",
      "https://0177.0.0.1/x",
      "https://127.1/x",
      "https://app.localhost/x",
    ]) {
      expect(ok(u)).toMatchObject({ ok: false, reason: "private_host" });
    }
  });
  test("allows public IP literals", () => {
    expect(ok("https://8.8.8.8/x").ok).toBe(true);
    expect(ok("https://[2606:4700:4700::1111]/x").ok).toBe(true);
  });
});

describe("checkOutboundUrl (MT_ALLOW_PRIVATE_HOSTS=1, development)", () => {
  const dev = (u: string) => checkOutboundUrl(u, { allowPrivateHosts: true });
  test("allows http and localhost", () => {
    expect(dev("http://localhost:3101/hook").ok).toBe(true);
    expect(dev("http://127.0.0.1:8080/x").ok).toBe(true);
    expect(dev("https://10.0.0.5/x").ok).toBe(true);
  });
  test("still rejects other schemes, user info, and invalid URLs", () => {
    expect(dev("ftp://localhost/x")).toMatchObject({ ok: false, reason: "scheme_not_allowed" });
    expect(dev("http://u:p@localhost/x")).toMatchObject({ ok: false, reason: "userinfo_not_allowed" });
    expect(dev("nope")).toMatchObject({ ok: false, reason: "invalid_url" });
  });
});
