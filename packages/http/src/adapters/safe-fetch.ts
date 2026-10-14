// packages/http/src/adapters/safe-fetch.ts
//
// The only HTTP client for admin-entered URLs: the backend-uatis and web-nf
// base URLs and outbound webhook URLs (07.security.md "SSRF guard", ADR-009,
// ADR-017 #5; FR-148, NFR-014).
//
// Steps, in production (`allowPrivateHosts` false):
//   1. `https:` only, no user info, no private literal or local name (core `checkOutboundUrl`).
//   2. Resolve the name; refuse when ANY address is blocked (core `isBlockedAddress`).
//   3. Connect to the address that was checked: the check runs inside the
//      socket's `lookup` hook, so no second DNS answer is ever used (DNS
//      rebinding). `Host` and TLS SNI keep the original name.
//   4. Follow no redirect. A 3xx is a failure.
//   5. Apply the timeout and the response size cap.
//
// With `allowPrivateHosts` (MT_ALLOW_PRIVATE_HOSTS=1, development only) steps 1
// and 2 allow `http:` and private addresses.
//
// Failures throw `GatewayError` with a kind the retry classifiers understand
// (core retry-schedule.ts): `refused` (nothing left), `connection_error` (the
// request never left), `network_error` or `timeout` (it may have left), or
// `http` (a redirect or an oversized answer).

import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";

import { checkOutboundUrl, GatewayError, isBlockedAddress } from "@mt/core";

export interface SafeRequest {
  readonly method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Sent byte for byte. */
  readonly body?: string;
}

export interface SafeResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export type SafeFetch = (request: SafeRequest) => Promise<SafeResponse>;

export interface ResolvedAddress {
  readonly address: string;
  readonly family: number;
}

export interface SafeFetchOptions {
  /** `MT_ALLOW_PRIVATE_HOSTS=1`. Never true in production (the apps refuse to start). */
  readonly allowPrivateHosts: boolean;
  /** Default 10 000 ms (04.architecture.md "Queue design"). */
  readonly timeoutMs?: number;
  /** Default 1 MiB. */
  readonly maxResponseBytes?: number;
  /** DNS resolver, injectable for tests. Default `dns.lookup(host, { all: true })`. */
  readonly resolve?: (hostname: string) => Promise<readonly ResolvedAddress[]>;
}

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

/** Error codes that mean the request never left this process. */
const BEFORE_SEND = new Set([
  "ECONNREFUSED",
  "ConnectionRefused",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EAI_NONAME",
  "EAI_FAIL",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EADDRNOTAVAIL",
  "FailedToOpenSocket",
]);

const BLOCKED = "EMT_HOST_BLOCKED";

async function defaultResolve(hostname: string): Promise<readonly ResolvedAddress[]> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

function makeLookup(resolve: NonNullable<SafeFetchOptions["resolve"]>, allowPrivateHosts: boolean): LookupFunction {
  return ((hostname: string, opts: unknown, callback: (...args: unknown[]) => void) => {
    const cb = typeof opts === "function" ? (opts as typeof callback) : callback;
    const all = typeof opts === "object" && opts !== null && (opts as { all?: boolean }).all === true;
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0) {
          cb(Object.assign(new Error(`no address for ${hostname}`), { code: "ENOTFOUND" }));
          return;
        }
        if (!allowPrivateHosts && addresses.some((a) => isBlockedAddress(a.address))) {
          cb(Object.assign(new Error("host resolves to a blocked address"), { code: BLOCKED }));
          return;
        }
        // Step 3: the socket connects to an address checked right here.
        const first = addresses[0] as ResolvedAddress;
        if (all)
          cb(
            null,
            addresses.map((a) => ({ address: a.address, family: a.family })),
          );
        else cb(null, first.address, first.family);
      },
      (error: unknown) => cb(error),
    );
  }) as unknown as LookupFunction;
}

function errorCodeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
}

export function createSafeFetch(options: SafeFetchOptions): SafeFetch {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const lookup = makeLookup(options.resolve ?? defaultResolve, options.allowPrivateHosts);

  return (request) =>
    new Promise<SafeResponse>((resolvePromise, reject) => {
      const check = checkOutboundUrl(request.url, { allowPrivateHosts: options.allowPrivateHosts });
      if (!check.ok) {
        const code = check.reason === "private_host" ? "host_not_allowed" : check.reason;
        reject(GatewayError.refused(code));
        return;
      }
      const url = new URL(request.url);
      const client = url.protocol === "https:" ? https : http;
      const body = request.body === undefined ? undefined : Buffer.from(request.body, "utf8");

      let settled = false;
      let sent = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const req = client.request(
        {
          protocol: url.protocol,
          hostname: url.hostname.replace(/^\[|\]$/g, ""),
          port: url.port === "" ? undefined : Number(url.port),
          path: `${url.pathname}${url.search}`,
          method: request.method,
          headers: {
            ...(request.headers ?? {}),
            ...(body === undefined ? {} : { "content-length": String(body.byteLength) }),
          },
          lookup,
          servername: url.hostname,
        },
        (res) => {
          sent = true;
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            res.resume();
            done(() => reject(GatewayError.http(status, "redirect_not_followed")));
            req.destroy();
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.byteLength;
            if (size > maxBytes) {
              done(() => reject(GatewayError.http(status, "response_too_large")));
              req.destroy();
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => {
            const headers: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) {
              if (typeof v === "string") headers[k] = v;
              else if (Array.isArray(v)) headers[k] = v.join(", ");
            }
            done(() => resolvePromise({ status, headers, body: Buffer.concat(chunks).toString("utf8") }));
          });
          res.on("error", () => done(() => reject(GatewayError.network())));
        },
      );

      // Once the socket is connected, the request bytes may reach the remote:
      // any failure from then on is ambiguous for a non-idempotent call.
      req.on("socket", (socket) => {
        const markSent = () => {
          sent = true;
        };
        socket.once(url.protocol === "https:" ? "secureConnect" : "connect", markSent);
      });

      req.on("error", (error) => {
        const code = errorCodeOf(error);
        if (code === BLOCKED) {
          done(() => reject(GatewayError.refused("host_not_allowed")));
        } else if (!sent || BEFORE_SEND.has(code)) {
          done(() => reject(GatewayError.connection()));
        } else {
          done(() => reject(GatewayError.network()));
        }
      });

      const timer = setTimeout(() => {
        // A timeout before the socket connected is a connection failure: nothing left.
        done(() => reject(sent ? GatewayError.timeout() : GatewayError.connection()));
        req.destroy();
      }, timeoutMs);

      if (body !== undefined) req.write(body);
      req.end();
    });
}
