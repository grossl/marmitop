// covers NFR-010, NFR-011, FR-085, FR-088, FR-094

import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { AppError } from "./errors";
import { EnvelopeSecretBox, FakeSecretBox, parseKek, type SecretContext } from "./secret-box";

const kek = () => new Uint8Array(randomBytes(32));
const ctx: SecretContext = { restaurantId: "r1", secretId: "s1", kind: "uatis_api_key" };

describe("EnvelopeSecretBox (ADR-012, 07.security.md)", () => {
  test("round trip returns the plaintext", async () => {
    const box = new EnvelopeSecretBox({ kek: kek() });
    const sealed = await box.seal("obk_live_supersecretvalue", ctx);
    expect(await box.open(sealed, ctx)).toBe("obk_live_supersecretvalue");
  });
  test("output layout: iv 12, ciphertext = plaintext + 16-byte tag, wrapped key = iv(12) + key(32) + tag(16)", async () => {
    const box = new EnvelopeSecretBox({ kek: kek() });
    const plaintext = "hello-secret";
    const sealed = await box.seal(plaintext, ctx);
    expect(sealed.iv.length).toBe(12);
    expect(sealed.ciphertext.length).toBe(Buffer.byteLength(plaintext) + 16);
    expect(sealed.wrappedKey.length).toBe(12 + 32 + 16);
    expect(sealed.kekVersion).toBe(1);
    expect(sealed.last4).toBe("cret");
  });
  test("the ciphertext does not contain the plaintext", async () => {
    const box = new EnvelopeSecretBox({ kek: kek() });
    const sealed = await box.seal("plain-visible-text", ctx);
    expect(Buffer.from(sealed.ciphertext).toString("utf8")).not.toContain("plain-visible");
    expect(Buffer.from(sealed.wrappedKey).toString("latin1")).not.toContain("plain-visible");
  });
  test("each seal uses a fresh data key and iv", async () => {
    const box = new EnvelopeSecretBox({ kek: kek() });
    const a = await box.seal("same", ctx);
    const b = await box.seal("same", ctx);
    expect(Buffer.from(a.iv).equals(Buffer.from(b.iv))).toBe(false);
    expect(Buffer.from(a.wrappedKey).equals(Buffer.from(b.wrappedKey))).toBe(false);
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(false);
  });
  test("a wrong KEK fails", async () => {
    const sealed = await new EnvelopeSecretBox({ kek: kek() }).seal("x-secret-value", ctx);
    await expect(new EnvelopeSecretBox({ kek: kek() }).open(sealed, ctx)).rejects.toBeInstanceOf(AppError);
  });
  test("the AAD binds restaurant id, secret id, and kind (cross-tenant ciphertext swap fails)", async () => {
    const box = new EnvelopeSecretBox({ kek: kek() });
    const sealed = await box.seal("x-secret-value", ctx);
    await expect(box.open(sealed, { ...ctx, restaurantId: "r2" })).rejects.toBeInstanceOf(AppError);
    await expect(box.open(sealed, { ...ctx, secretId: "s2" })).rejects.toBeInstanceOf(AppError);
    await expect(box.open(sealed, { ...ctx, kind: "webnf_api_key" })).rejects.toBeInstanceOf(AppError);
  });
  test("tampered ciphertext, iv, or wrapped key fails", async () => {
    const box = new EnvelopeSecretBox({ kek: kek() });
    const sealed = await box.seal("x-secret-value", ctx);
    const flip = (u: Uint8Array) => {
      const c = new Uint8Array(u);
      c[0] = (c[0] as number) ^ 1;
      return c;
    };
    await expect(box.open({ ...sealed, ciphertext: flip(sealed.ciphertext) }, ctx)).rejects.toBeInstanceOf(AppError);
    await expect(box.open({ ...sealed, iv: flip(sealed.iv) }, ctx)).rejects.toBeInstanceOf(AppError);
    await expect(box.open({ ...sealed, wrappedKey: flip(sealed.wrappedKey) }, ctx)).rejects.toBeInstanceOf(AppError);
  });
  test("a failure never leaks the plaintext or the key into the message", async () => {
    const box = new EnvelopeSecretBox({ kek: kek() });
    const sealed = await box.seal("leak-me-not-1234", ctx);
    try {
      await new EnvelopeSecretBox({ kek: kek() }).open(sealed, ctx);
      throw new Error("should fail");
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("leak-me-not");
      expect((e as AppError).code).toBe("internal_error");
    }
  });
  test("unicode plaintext round trips; a short secret gets no last4 hint", async () => {
    const box = new EnvelopeSecretBox({ kek: kek() });
    expect((await box.seal("abc", ctx)).last4).toBe("");
    expect((await box.seal("obk_test_abcdefgh1234", ctx)).last4).toBe("1234");
    expect(await box.open(await box.seal("segredo-ção-🍱", ctx), ctx)).toBe("segredo-ção-🍱");
  });
  test("rejects a KEK that is not 32 bytes", () => {
    expect(() => new EnvelopeSecretBox({ kek: new Uint8Array(16) })).toThrow();
  });

  test("KEK rotation: a previous KEK opens old rows, rewrap moves them to the new KEK without touching the payload", async () => {
    const oldKek = kek();
    const newKek = kek();
    const oldBox = new EnvelopeSecretBox({ kek: oldKek, kekVersion: 1 });
    const sealed = await oldBox.seal("rotate-me-1234", ctx);

    const rotating = new EnvelopeSecretBox({ kek: newKek, kekVersion: 2, previous: { kek: oldKek, kekVersion: 1 } });
    expect(await rotating.open(sealed, ctx)).toBe("rotate-me-1234");

    const rewrapped = await rotating.rewrap(sealed, ctx);
    expect(rewrapped.kekVersion).toBe(2);
    expect(Buffer.from(rewrapped.ciphertext).equals(Buffer.from(sealed.ciphertext))).toBe(true);
    expect(Buffer.from(rewrapped.iv).equals(Buffer.from(sealed.iv))).toBe(true);
    expect(Buffer.from(rewrapped.wrappedKey).equals(Buffer.from(sealed.wrappedKey))).toBe(false);

    const afterRotation = new EnvelopeSecretBox({ kek: newKek, kekVersion: 2 });
    expect(await afterRotation.open(rewrapped, ctx)).toBe("rotate-me-1234");
    await expect(afterRotation.open(sealed, ctx)).rejects.toBeInstanceOf(AppError);
  });
});

describe("parseKek", () => {
  test("decodes 32 bytes of base64", () => {
    const raw = randomBytes(32);
    expect(Buffer.from(parseKek(raw.toString("base64"))).equals(raw)).toBe(true);
  });
  test("rejects other lengths and non-base64 without echoing the value", () => {
    for (const bad of ["", "abc", Buffer.alloc(16).toString("base64"), Buffer.alloc(33).toString("base64")]) {
      try {
        parseKek(bad);
        throw new Error("should fail");
      } catch (e) {
        expect((e as Error).message).toContain("MT_KEK");
        if (bad) expect((e as Error).message).not.toContain(bad);
      }
    }
  });
});

describe("FakeSecretBox", () => {
  test("round trips and still checks the context", async () => {
    const box = new FakeSecretBox();
    const sealed = await box.seal("fake-secret-value", ctx);
    expect(sealed.last4).toBe("alue");
    expect(await box.open(sealed, ctx)).toBe("fake-secret-value");
    await expect(box.open(sealed, { ...ctx, restaurantId: "other" })).rejects.toBeInstanceOf(AppError);
  });
});
