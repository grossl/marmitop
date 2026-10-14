// SecretBox port (ADR-012, 07.security.md). Envelope encryption hides behind it, so a KMS or
// Supabase Vault can replace the implementation with no caller change.

export type SecretKind =
  | "uatis_api_key"
  | "uatis_webhook_secret"
  | "webnf_api_key"
  | "webnf_webhook_secret"
  | "outbound_webhook_secret";

/** The AAD binds a ciphertext to its row: a copy into another tenant or kind fails the tag check. */
export interface SecretContext {
  readonly restaurantId: string;
  readonly secretId: string;
  readonly kind: SecretKind;
}

/** The columns of a `secrets` row that the box produces. */
export interface SealedSecret {
  /** AES-256-GCM output, tag appended. */
  readonly ciphertext: Uint8Array;
  /** 12 bytes. */
  readonly iv: Uint8Array;
  /** The data key under the KEK: iv(12) || ciphertext(32) || tag(16). */
  readonly wrappedKey: Uint8Array;
  readonly kekVersion: number;
  /** Last four characters of the plaintext, for display. */
  readonly last4: string;
}

export interface SecretBox {
  seal(plaintext: string, context: SecretContext): Promise<SealedSecret>;
  open(sealed: SealedSecret, context: SecretContext): Promise<string>;
}
