// covers FR-102, FR-103, FR-126, FR-146, FR-147, FR-148, NFR-012, NFR-013, NFR-050

import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { AppError } from "./errors";
import {
  buildOutboundWebhookHeaders,
  constantTimeEqualHex,
  MAX_WEBHOOK_BODY_BYTES,
  SIGNATURE_HEADERS,
  signWebhook,
  verifyNfSignature,
  verifySignature,
  verifyUatisSignature,
} from "./webhook-signature";

const SECRET = "whsec_test_secret";
const BODY = '{"hello":"world"}';
const T = 1760356800;
const now = new Date(T * 1000);
const hmac = (secret: string, t: number, body: string) =>
  createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");

describe("signWebhook", () => {
  test("matches a fixed vector computed by an independent implementation (python hmac)", () => {
    expect(signWebhook(SECRET, T, BODY)).toBe(
      "t=1760356800,v1=7d06562337e3a5e4a1791334faaf6fd7a57492e399e88e2cffd7b7f81ec311b6",
    );
  });
  test("matches node crypto for arbitrary input, including utf-8 bodies", () => {
    const body = '{"nome":"João","emoji":"🍱"}';
    expect(signWebhook("s3cret", 42, body)).toBe(`t=42,v1=${hmac("s3cret", 42, body)}`);
    expect(signWebhook("s3cret", 42, new TextEncoder().encode(body))).toBe(`t=42,v1=${hmac("s3cret", 42, body)}`);
  });
  test("refuses an empty secret", () => {
    expect(() => signWebhook("", T, BODY)).toThrow();
  });
});

describe("verifySignature: the shared four cases", () => {
  const header = signWebhook(SECRET, T, BODY);
  test("valid signature passes", () => {
    expect(verifySignature({ header, rawBody: BODY, secret: SECRET, now })).toEqual({ ok: true });
  });
  test("sign output verifies with verify (round trip)", () => {
    for (const body of ["", "x", '{"a":[1,2,3]}', "é".repeat(1000)]) {
      const h = signWebhook(SECRET, T, body);
      expect(verifySignature({ header: h, rawBody: body, secret: SECRET, now }).ok).toBe(true);
    }
  });
  test("tampered body fails", () => {
    expect(verifySignature({ header, rawBody: `${BODY} `, secret: SECRET, now })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });
  test("wrong secret fails", () => {
    expect(verifySignature({ header, rawBody: BODY, secret: "other", now })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });
  test("timestamp older or newer than 5 minutes fails, exactly 5 minutes passes", () => {
    const old = signWebhook(SECRET, T - 301, BODY);
    const future = signWebhook(SECRET, T + 301, BODY);
    expect(verifySignature({ header: old, rawBody: BODY, secret: SECRET, now })).toEqual({
      ok: false,
      reason: "timestamp_out_of_tolerance",
    });
    expect(verifySignature({ header: future, rawBody: BODY, secret: SECRET, now }).ok).toBe(false);
    expect(verifySignature({ header: signWebhook(SECRET, T - 300, BODY), rawBody: BODY, secret: SECRET, now }).ok).toBe(
      true,
    );
    expect(verifySignature({ header: signWebhook(SECRET, T + 300, BODY), rawBody: BODY, secret: SECRET, now }).ok).toBe(
      true,
    );
  });
  test("a custom tolerance applies", () => {
    const h = signWebhook(SECRET, T - 60, BODY);
    expect(verifySignature({ header: h, rawBody: BODY, secret: SECRET, now, toleranceSeconds: 30 }).ok).toBe(false);
  });
  test("missing header, missing t, missing v1, non-hex v1, non-integer t fail as malformed", () => {
    const bad = [
      undefined,
      null,
      "",
      `v1=${hmac(SECRET, T, BODY)}`,
      `t=${T}`,
      `t=${T},v1=zzzz`,
      `t=${T},v1=`,
      `t=abc,v1=${hmac(SECRET, T, BODY)}`,
      `t=${T}.5,v1=${hmac(SECRET, T, BODY)}`,
      "garbage",
    ];
    for (const h of bad) {
      expect(verifySignature({ header: h, rawBody: BODY, secret: SECRET, now })).toEqual({
        ok: false,
        reason: "malformed_header",
      });
    }
  });
  test("a v1 of the wrong length fails without throwing", () => {
    expect(verifySignature({ header: `t=${T},v1=abcd`, rawBody: BODY, secret: SECRET, now }).ok).toBe(false);
  });
  test("multiple v1 values (rotation) pass when any one matches", () => {
    const good = hmac(SECRET, T, BODY);
    const bogus = "0".repeat(64);
    expect(verifySignature({ header: `t=${T},v1=${bogus},v1=${good}`, rawBody: BODY, secret: SECRET, now }).ok).toBe(
      true,
    );
    expect(verifySignature({ header: `t=${T},v1=${good},v1=${bogus}`, rawBody: BODY, secret: SECRET, now }).ok).toBe(
      true,
    );
    expect(verifySignature({ header: `t=${T},v1=${bogus},v1=${bogus}`, rawBody: BODY, secret: SECRET, now }).ok).toBe(
      false,
    );
  });
  test("uppercase hex is accepted", () => {
    const h = `t=${T},v1=${hmac(SECRET, T, BODY).toUpperCase()}`;
    expect(verifySignature({ header: h, rawBody: BODY, secret: SECRET, now }).ok).toBe(true);
  });
  test("a body over 256 KB is rejected before any hashing", () => {
    const big = "a".repeat(MAX_WEBHOOK_BODY_BYTES + 1);
    expect(verifySignature({ header: signWebhook(SECRET, T, big), rawBody: big, secret: SECRET, now })).toEqual({
      ok: false,
      reason: "body_too_large",
    });
  });
  test("an empty secret never verifies", () => {
    expect(verifySignature({ header, rawBody: BODY, secret: "", now })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });
});

describe("header-specific verifiers (same cases for each header name)", () => {
  test("header names", () => {
    expect(SIGNATURE_HEADERS).toEqual({
      uatis: "X-Uatis-Signature",
      nf: "X-NF-Signature",
      marmitop: "X-Marmitop-Signature",
    });
  });
  const verifiers = [
    ["X-Uatis-Signature", verifyUatisSignature],
    ["X-NF-Signature", verifyNfSignature],
  ] as const;
  for (const [name, verify] of verifiers) {
    describe(name, () => {
      const headers = (value: string) => new Headers({ [name]: value });
      test("valid passes (header lookup is case-insensitive)", () => {
        expect(verify({ headers: headers(signWebhook(SECRET, T, BODY)), rawBody: BODY, secret: SECRET, now }).ok).toBe(
          true,
        );
        expect(
          verify({
            headers: { [name.toLowerCase()]: signWebhook(SECRET, T, BODY) },
            rawBody: BODY,
            secret: SECRET,
            now,
          }).ok,
        ).toBe(true);
      });
      test("tampered body, wrong secret, stale timestamp, missing header all fail", () => {
        const h = headers(signWebhook(SECRET, T, BODY));
        expect(verify({ headers: h, rawBody: "x", secret: SECRET, now }).ok).toBe(false);
        expect(verify({ headers: h, rawBody: BODY, secret: "nope", now }).ok).toBe(false);
        expect(
          verify({ headers: headers(signWebhook(SECRET, T - 600, BODY)), rawBody: BODY, secret: SECRET, now }).ok,
        ).toBe(false);
        const r = verify({ headers: new Headers(), rawBody: BODY, secret: SECRET, now });
        expect(r).toEqual({ ok: false, reason: "malformed_header" });
      });
      test("a header for another system does not verify", () => {
        const other = name === "X-NF-Signature" ? "X-Uatis-Signature" : "X-NF-Signature";
        expect(
          verify({ headers: { [other]: signWebhook(SECRET, T, BODY) }, rawBody: BODY, secret: SECRET, now }).ok,
        ).toBe(false);
      });
    });
  }
});

describe("outbound headers (X-Marmitop-Signature, FR-147)", () => {
  test("carries signature, event, and delivery id; a verifier accepts it and rejects a changed body", () => {
    const headers = buildOutboundWebhookHeaders({
      secret: SECRET,
      event: "order.created",
      deliveryId: "d-1",
      body: BODY,
      now,
    });
    expect(headers["X-Marmitop-Event"]).toBe("order.created");
    expect(headers["X-Marmitop-Delivery"]).toBe("d-1");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Marmitop-Signature"]).toBe(signWebhook(SECRET, T, BODY));
    const sig = headers["X-Marmitop-Signature"];
    expect(verifySignature({ header: sig, rawBody: BODY, secret: SECRET, now }).ok).toBe(true);
    expect(verifySignature({ header: sig, rawBody: `${BODY}x`, secret: SECRET, now }).ok).toBe(false);
  });
});

describe("constantTimeEqualHex (NFR-012)", () => {
  test("equal, different, different length, non-hex", () => {
    expect(constantTimeEqualHex("abcd", "abcd")).toBe(true);
    expect(constantTimeEqualHex("abcd", "abce")).toBe(false);
    expect(constantTimeEqualHex("abcd", "abcdef")).toBe(false);
    expect(constantTimeEqualHex("zz", "zz")).toBe(false);
    expect(constantTimeEqualHex("", "")).toBe(false);
  });
});

describe("signatureFailureToError", () => {
  test("maps a failed result to 401 signature_invalid, 413 for a big body", async () => {
    const { signatureFailureToError } = await import("./webhook-signature");
    const e = signatureFailureToError("signature_mismatch");
    expect(e).toBeInstanceOf(AppError);
    expect(e.code).toBe("signature_invalid");
    expect(e.httpStatus).toBe(401);
    expect(e.message).not.toContain("mismatch");
    expect(signatureFailureToError("body_too_large").httpStatus).toBe(413);
  });
});
