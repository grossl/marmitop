// SSRF host checks (ADR-009, ADR-017, 07.security.md "SSRF guard"; FR-148, NFR-014). Pure.
// This file decides on text and IP literals. The http package resolves DNS and pins the
// connection, then calls `isBlockedAddress` on every resolved address.

export type UrlRejection = "invalid_url" | "scheme_not_allowed" | "userinfo_not_allowed" | "private_host";

export type UrlCheck =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: UrlRejection };

function parseIPv4(text: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

function ipv4Blocked(p: readonly number[]): boolean {
  const [a, b, c] = p as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return a >= 224;
}

function parseIPv6(input: string): number[] | null {
  let text = input;
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  if (!text.includes(":")) return null;
  // a trailing dotted IPv4 becomes two groups
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    const hi = ((v4[0] as number) << 8) | (v4[1] as number);
    const lo = ((v4[2] as number) << 8) | (v4[3] as number);
    text = `${text.slice(0, lastColon + 1)}${hi.toString(16)}:${lo.toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const toGroups = (s: string): number[] | null => {
    if (s === "") return [];
    const out: number[] = [];
    for (const g of s.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(Number.parseInt(g, 16));
    }
    return out;
  };
  const head = toGroups(halves[0] as string);
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const rest = toGroups(halves[1] as string);
  if (!rest) return null;
  const missing = 8 - head.length - rest.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...rest];
}

function embeddedV4(hi: number, lo: number): number[] {
  return [hi >> 8, hi & 255, lo >> 8, lo & 255];
}

function ipv6Blocked(g: readonly number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10
  if (g0 >> 8 === 0xff) return true; // ff00::/8
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0) {
    if (g5 === 0) return true; // ::/96 covers :: and ::1
    if (g5 === 0xffff) return ipv4Blocked(embeddedV4(g6, g7)); // ::ffff:0:0/96 IPv4-mapped
  }
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return ipv4Blocked(embeddedV4(g6, g7)); // 64:ff9b::/96 NAT64
  }
  if (g0 === 0x2002) return ipv4Blocked(embeddedV4(g1, g2)); // 2002::/16 6to4
  return false;
}

/** True for a private, loopback, link-local, multicast, reserved, or unparseable IP address. */
export function isBlockedAddress(address: string): boolean {
  const text = address.trim().replace(/^\[|\]$/g, "");
  const v4 = parseIPv4(text);
  if (v4) return ipv4Blocked(v4);
  const v6 = parseIPv6(text);
  if (v6) return ipv6Blocked(v6);
  return true;
}

/** Names that point at the local machine or the internal network without DNS. */
export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || h === "localdomain") return true;
  return [".localhost", ".local", ".localdomain", ".internal", ".intranet", ".lan", ".home.arpa"].some((s) =>
    h.endsWith(s),
  );
}

export interface UrlCheckOptions {
  /** `MT_ALLOW_PRIVATE_HOSTS=1`: development only. Allows http and private hosts. */
  readonly allowPrivateHosts: boolean;
}

/**
 * Step 1 and the literal part of step 2 of the guard. A public hostname passes here; the
 * http package still resolves it and checks every address with `isBlockedAddress`.
 * `new URL` folds numeric IPv4 spellings (decimal, hex, octal, short forms) to dotted form.
 */
export function checkOutboundUrl(input: string, options: UrlCheckOptions): UrlCheck {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  const schemes = options.allowPrivateHosts ? ["https:", "http:"] : ["https:"];
  if (!schemes.includes(url.protocol)) return { ok: false, reason: "scheme_not_allowed" };
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "userinfo_not_allowed" };
  if (!options.allowPrivateHosts) {
    const host = url.hostname;
    const literal = host.startsWith("[") || /^\d+(\.\d+){0,3}$/.test(host) || /^0x[0-9a-f]+$/i.test(host);
    if (literal ? isBlockedAddress(host) : isBlockedHostname(host)) return { ok: false, reason: "private_host" };
  }
  return { ok: true, url: input };
}
