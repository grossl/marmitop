// Webhook signing and verification (ADR-002, ADR-003, ADR-009; FR-102, FR-103, FR-126,
// FR-147; NFR-012, NFR-013). One scheme serves three systems:
//
//   <Header>: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
//
// | System        | Header                | Direction |
// | backend-uatis | X-Uatis-Signature     | inbound   |
// | web-nf        | X-NF-Signature        | inbound   |
// | Marmitop      | X-Marmitop-Signature  | outbound  |
//
// Pure: node:crypto is a built-in, not I/O. Always verify over the raw bytes, before parsing.

import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors";

export const SIGNATURE_HEADERS = {
  uatis: "X-Uatis-Signature",
  nf: "X-NF-Signature",
  marmitop: "X-Marmitop-Signature",
} as const;

export const DEFAULT_TOLERANCE_SECONDS = 300;
/** 07.security.md: bodies over 256 KB are refused before any parsing. */
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

export type RawBody = string | Uint8Array;

export type SignatureFailureReason =
  | "malformed_header"
  | "timestamp_out_of_tolerance"
  | "signature_mismatch"
  | "body_too_large";

export type VerifyResult = { readonly ok: true } | { readonly ok: false; readonly reason: SignatureFailureReason };

function toBytes(body: RawBody): Uint8Array {
  return typeof body === "string" ? new TextEncoder().encode(body) : body;
}

function hmacHex(secret: string, timestamp: number, rawBody: RawBody): string {
  return createHmac("sha256", secret).update(`${timestamp}.`).update(toBytes(rawBody)).digest("hex");
}

const HEX = /^(?:[0-9a-fA-F]{2})+$/;

/**
 * The one comparison used for every signature check. Both inputs must be non-empty,
 * even-length hex and of equal length; the bytes compare with `timingSafeEqual`.
 */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (!HEX.test(a) || !HEX.test(b) || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** Build a header value. `timestamp` is Unix seconds. */
export function signWebhook(secret: string, timestamp: number, rawBody: RawBody): string {
  if (!secret) throw new Error("signWebhook: secret must not be empty");
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error("signWebhook: bad timestamp");
  return `t=${timestamp},v1=${hmacHex(secret, timestamp, rawBody)}`;
}

interface ParsedHeader {
  readonly timestamp: number;
  readonly signatures: readonly string[];
}

function parseHeader(header: string | null | undefined): ParsedHeader | null {
  if (!header) return null;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      if (!/^\d{1,12}$/.test(value)) return null;
      if (timestamp !== null) return null;
      timestamp = Number(value);
    } else if (key === "v1") {
      if (!HEX.test(value)) return null;
      signatures.push(value);
    }
  }
  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

export interface VerifyInput {
  readonly header: string | null | undefined;
  readonly rawBody: RawBody;
  readonly secret: string;
  readonly now: Date;
  readonly toleranceSeconds?: number;
}

/**
 * Steps (07.security.md): size cap, header parse, tolerance, HMAC over `t.body`, constant-time
 * compare against every `v1` value (several values allow secret rotation).
 */
export function verifySignature(input: VerifyInput): VerifyResult {
  const size = typeof input.rawBody === "string" ? Buffer.byteLength(input.rawBody) : input.rawBody.byteLength;
  if (size > MAX_WEBHOOK_BODY_BYTES) return { ok: false, reason: "body_too_large" };
  const parsed = parseHeader(input.header);
  if (!parsed) return { ok: false, reason: "malformed_header" };
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor(input.now.getTime() / 1000);
  if (Math.abs(nowSeconds - parsed.timestamp) > tolerance) return { ok: false, reason: "timestamp_out_of_tolerance" };
  if (!input.secret) return { ok: false, reason: "signature_mismatch" };
  const expected = hmacHex(input.secret, parsed.timestamp, input.rawBody);
  let matched = false;
  for (const candidate of parsed.signatures) {
    if (constantTimeEqualHex(expected, candidate.toLowerCase())) matched = true;
  }
  return matched ? { ok: true } : { ok: false, reason: "signature_mismatch" };
}

export type HeaderBag = Headers | Readonly<Record<string, string | undefined>>;

function readHeader(headers: HeaderBag, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

export interface VerifyHeadersInput {
  readonly headers: HeaderBag;
  readonly rawBody: RawBody;
  readonly secret: string;
  readonly now: Date;
  readonly toleranceSeconds?: number;
}

function verifyFromHeaders(name: string, input: VerifyHeadersInput): VerifyResult {
  return verifySignature({
    header: readHeader(input.headers, name),
    rawBody: input.rawBody,
    secret: input.secret,
    now: input.now,
    ...(input.toleranceSeconds !== undefined ? { toleranceSeconds: input.toleranceSeconds } : {}),
  });
}

/** FR-102: `POST /v1/webhooks/uatis/{restaurant_id}`. */
export function verifyUatisSignature(input: VerifyHeadersInput): VerifyResult {
  return verifyFromHeaders(SIGNATURE_HEADERS.uatis, input);
}

/** FR-126: `POST /v1/webhooks/web-nf/{restaurant_id}`. */
export function verifyNfSignature(input: VerifyHeadersInput): VerifyResult {
  return verifyFromHeaders(SIGNATURE_HEADERS.nf, input);
}

/** Lets an integrator-style check run in Marmitop's own tests (FR-147). */
export function verifyMarmitopSignature(input: VerifyHeadersInput): VerifyResult {
  return verifyFromHeaders(SIGNATURE_HEADERS.marmitop, input);
}

/** The body for an `AppError`; the message never says which check failed. */
export function signatureFailureToError(reason: SignatureFailureReason): AppError {
  return new AppError("signature_invalid", "Webhook signature is invalid.", {
    ...(reason === "body_too_large" ? { httpStatus: 413 } : {}),
  });
}

export interface OutboundHeadersInput {
  readonly secret: string;
  readonly event: string;
  readonly deliveryId: string;
  readonly body: string;
  readonly now: Date;
}

/** FR-147: headers for one outbound delivery. The body string is sent byte for byte. */
export function buildOutboundWebhookHeaders(input: OutboundHeadersInput): Record<string, string> {
  return {
    "Content-Type": "application/json",
    [SIGNATURE_HEADERS.marmitop]: signWebhook(input.secret, Math.floor(input.now.getTime() / 1000), input.body),
    "X-Marmitop-Event": input.event,
    "X-Marmitop-Delivery": input.deliveryId,
  };
}
