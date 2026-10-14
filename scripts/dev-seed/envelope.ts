// scripts/dev-seed/envelope.ts
//
// Envelope encryption of the seeded secrets, byte for byte the layout in
// 07.security.md "Envelope encryption" (ADR-012):
//
//   AAD          = `secret:v1:{restaurant_id}:{secret_id}:{kind}`
//   ciphertext   = AES-256-GCM(dataKey, iv, plaintext, AAD) ‖ tag(16)
//   iv           = 12 bytes
//   wrapped_key  = wrapIv(12) ‖ AES-256-GCM(KEK, wrapIv, dataKey, AAD) ‖ tag(16)
//
// Production draws the data key and both IVs from a CSPRNG. The seed derives
// them from the dev KEK with HMAC, so the generated seed.sql is byte-stable.
// That shortcut is acceptable only for committed dev fixtures.

import { createCipheriv, createDecipheriv, createHmac } from "node:crypto";

export interface SealedSecret {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  wrappedKey: Uint8Array;
  last4: string;
}

export function secretAad(restaurantId: string, secretId: string, kind: string): Buffer {
  return Buffer.from(`secret:v1:${restaurantId}:${secretId}:${kind}`, "utf8");
}

function gcmEncrypt(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Buffer {
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

function gcmDecrypt(key: Uint8Array, iv: Uint8Array, sealed: Uint8Array, aad: Uint8Array): Buffer {
  const body = sealed.subarray(0, sealed.length - 16);
  const tag = sealed.subarray(sealed.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

function derive(kek: Uint8Array, label: string, length: number): Buffer {
  return createHmac("sha256", kek).update(label).digest().subarray(0, length);
}

export function sealDeterministic(
  kekBase64: string,
  restaurantId: string,
  secretId: string,
  kind: string,
  plaintext: string,
): SealedSecret {
  const kek = Buffer.from(kekBase64, "base64");
  if (kek.length !== 32) throw new Error("MT_KEK must be 32 bytes");
  const aad = secretAad(restaurantId, secretId, kind);
  const dataKey = derive(kek, `seed:data-key:${secretId}`, 32);
  const iv = derive(kek, `seed:iv:${secretId}`, 12);
  const wrapIv = derive(kek, `seed:wrap-iv:${secretId}`, 12);
  const ciphertext = gcmEncrypt(dataKey, iv, Buffer.from(plaintext, "utf8"), aad);
  const wrappedKey = Buffer.concat([wrapIv, gcmEncrypt(kek, wrapIv, dataKey, aad)]);
  dataKey.fill(0);
  return { ciphertext, iv, wrappedKey, last4: plaintext.slice(-4) };
}

/** The reverse, used by verify.ts to prove a seeded row decrypts. */
export function open(
  kekBase64: string,
  restaurantId: string,
  secretId: string,
  kind: string,
  sealed: { ciphertext: Uint8Array; iv: Uint8Array; wrappedKey: Uint8Array },
): string {
  const kek = Buffer.from(kekBase64, "base64");
  const aad = secretAad(restaurantId, secretId, kind);
  const wrapIv = sealed.wrappedKey.subarray(0, 12);
  const dataKey = gcmDecrypt(kek, wrapIv, sealed.wrappedKey.subarray(12), aad);
  try {
    return gcmDecrypt(dataKey, sealed.iv, sealed.ciphertext, aad).toString("utf8");
  } finally {
    dataKey.fill(0);
  }
}
