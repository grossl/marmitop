// SecretBox implementations (ADR-012, 07.security.md "Envelope encryption"; NFR-010, NFR-011).
// node:crypto only; no I/O.
//
// seal: random 32-byte data key + 12-byte iv -> AES-256-GCM(plaintext, AAD) -> ciphertext||tag.
//       The data key is wrapped under the KEK with a fresh iv and the same AAD:
//       wrapped_key = iv(12) || ciphertext(32) || tag(16).
// AAD:  secret:v1:{restaurant_id}:{secret_id}:{kind}

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "./errors";
import type { SealedSecret, SecretBox, SecretContext } from "./ports/secret-box";

export type { SealedSecret, SecretBox, SecretContext, SecretKind } from "./ports/secret-box";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const KEY_LEN = 32;
const TAG_LEN = 16;

function aad(ctx: SecretContext): Buffer {
  return Buffer.from(`secret:v1:${ctx.restaurantId}:${ctx.secretId}:${ctx.kind}`, "utf8");
}

function gcmEncrypt(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array, aadBytes: Buffer): Buffer {
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  cipher.setAAD(aadBytes);
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

function gcmDecrypt(key: Uint8Array, iv: Uint8Array, sealed: Uint8Array, aadBytes: Buffer): Buffer {
  if (sealed.length < TAG_LEN) throw new Error("short ciphertext");
  const body = sealed.subarray(0, sealed.length - TAG_LEN);
  const tag = sealed.subarray(sealed.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  decipher.setAAD(aadBytes);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/** Display hint only. Short values would leak whole, so they get no hint. */
export function displayLast4(plaintext: string): string {
  return plaintext.length >= 12 ? plaintext.slice(-4) : "";
}

function failure(cause: unknown): AppError {
  // Never include plaintext, keys, or the underlying message in the text.
  return new AppError("internal_error", "Secret could not be decrypted.", { cause });
}

/** MT_KEK: 32 bytes, base64. The error never echoes the value. */
export function parseKek(base64: string): Uint8Array {
  const ok = /^[A-Za-z0-9+/]+={0,2}$/.test(base64);
  const bytes = ok ? Buffer.from(base64, "base64") : Buffer.alloc(0);
  if (bytes.length !== KEY_LEN) throw new Error("MT_KEK must be 32 bytes, base64-encoded.");
  return new Uint8Array(bytes);
}

export interface KekRef {
  readonly kek: Uint8Array;
  readonly kekVersion: number;
}

export interface EnvelopeSecretBoxOptions {
  readonly kek: Uint8Array;
  /** Version stamped on new rows. Default 1. */
  readonly kekVersion?: number;
  /** `MT_KEK_PREVIOUS`, set only during a KEK rotation. */
  readonly previous?: KekRef;
}

export class EnvelopeSecretBox implements SecretBox {
  private readonly current: KekRef;
  private readonly previous: KekRef | undefined;

  constructor(options: EnvelopeSecretBoxOptions) {
    if (options.kek.length !== KEY_LEN) throw new Error("KEK must be 32 bytes.");
    if (options.previous && options.previous.kek.length !== KEY_LEN) throw new Error("Previous KEK must be 32 bytes.");
    this.current = { kek: options.kek, kekVersion: options.kekVersion ?? 1 };
    this.previous = options.previous;
  }

  private kekFor(version: number): Uint8Array {
    if (version === this.current.kekVersion) return this.current.kek;
    if (this.previous && version === this.previous.kekVersion) return this.previous.kek;
    throw new Error("unknown kek version");
  }

  async seal(plaintext: string, context: SecretContext): Promise<SealedSecret> {
    const dataKey = randomBytes(KEY_LEN);
    try {
      const iv = randomBytes(IV_LEN);
      const aadBytes = aad(context);
      const ciphertext = gcmEncrypt(dataKey, iv, Buffer.from(plaintext, "utf8"), aadBytes);
      const wrapIv = randomBytes(IV_LEN);
      const wrappedKey = Buffer.concat([wrapIv, gcmEncrypt(this.current.kek, wrapIv, dataKey, aadBytes)]);
      return {
        ciphertext: new Uint8Array(ciphertext),
        iv: new Uint8Array(iv),
        wrappedKey: new Uint8Array(wrappedKey),
        kekVersion: this.current.kekVersion,
        last4: displayLast4(plaintext),
      };
    } finally {
      dataKey.fill(0);
    }
  }

  private unwrap(sealed: SealedSecret, context: SecretContext): Buffer {
    const wrapped = sealed.wrappedKey;
    if (wrapped.length !== IV_LEN + KEY_LEN + TAG_LEN) throw new Error("bad wrapped key");
    return gcmDecrypt(
      this.kekFor(sealed.kekVersion),
      wrapped.subarray(0, IV_LEN),
      wrapped.subarray(IV_LEN),
      aad(context),
    );
  }

  async open(sealed: SealedSecret, context: SecretContext): Promise<string> {
    let dataKey: Buffer | undefined;
    try {
      dataKey = this.unwrap(sealed, context);
      return gcmDecrypt(dataKey, sealed.iv, sealed.ciphertext, aad(context)).toString("utf8");
    } catch (cause) {
      throw failure(cause);
    } finally {
      dataKey?.fill(0);
    }
  }

  /**
   * KEK rotation step 2 (07.security.md): unwrap the data key with the KEK that matches
   * `kekVersion`, wrap it again under the current KEK. The payload does not change.
   */
  async rewrap(sealed: SealedSecret, context: SecretContext): Promise<SealedSecret> {
    let dataKey: Buffer | undefined;
    try {
      dataKey = this.unwrap(sealed, context);
      const wrapIv = randomBytes(IV_LEN);
      const wrappedKey = Buffer.concat([wrapIv, gcmEncrypt(this.current.kek, wrapIv, dataKey, aad(context))]);
      return { ...sealed, wrappedKey: new Uint8Array(wrappedKey), kekVersion: this.current.kekVersion };
    } catch (cause) {
      throw failure(cause);
    } finally {
      dataKey?.fill(0);
    }
  }
}

/** Test double (04.architecture.md): no encryption, but it still checks the context. */
export class FakeSecretBox implements SecretBox {
  async seal(plaintext: string, context: SecretContext): Promise<SealedSecret> {
    const tagged = `${aad(context).toString("utf8")}\u0000${plaintext}`;
    return {
      ciphertext: new TextEncoder().encode(tagged),
      iv: new Uint8Array(IV_LEN),
      wrappedKey: new Uint8Array(0),
      kekVersion: 1,
      last4: displayLast4(plaintext),
    };
  }

  async open(sealed: SealedSecret, context: SecretContext): Promise<string> {
    const text = new TextDecoder().decode(sealed.ciphertext);
    const prefix = `${aad(context).toString("utf8")}\u0000`;
    if (!text.startsWith(prefix)) throw failure(new Error("context mismatch"));
    return text.slice(prefix.length);
  }
}
