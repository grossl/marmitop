// Shared helpers for the admin services: sealed secrets and audit rows.
// Plaintext secrets live only in local variables of the calling service.
// Nothing here returns, logs, or audits a plaintext value (07.security.md, NFR-011).

import { AppError, type SecretKind } from "@mt/core";
import type { Tx } from "@mt/db";

import type { ServiceContext } from "../../context";
import type { ServiceDeps } from "../../deps";

export interface StoredSecret {
  readonly id: string;
  readonly last4: string;
}

/** "configurado" plus the last four characters; the only form a secret takes toward the browser (FR-094). */
export interface SecretState {
  readonly configured: boolean;
  readonly last4: string;
}

export const NO_SECRET: SecretState = { configured: false, last4: "" };

/** Writes an audit row. `context` must hold kind and last4 only, never a value. */
export async function writeAudit(
  tx: Tx,
  ctx: ServiceContext,
  entry: {
    readonly action: string;
    readonly entityType: string;
    readonly entityId: string | null;
    readonly context: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  await tx`
    insert into public.audit_logs (restaurant_id, actor_type, actor_id, action, entity_type, entity_id, context)
    values (
      ${ctx.restaurantId},
      ${ctx.actorType},
      ${ctx.actorType === "user" ? ctx.userId : ctx.actorType === "api_key" ? ctx.apiKeyId : null},
      ${entry.action},
      ${entry.entityType},
      ${entry.entityId},
      ${JSON.stringify(entry.context)}::jsonb
    )
  `;
}

/** Seals `plaintext` into a new `secrets` row. A rotation inserts a new row; the caller deletes the old one. */
export async function storeSecret(
  tx: Tx,
  deps: ServiceDeps,
  ctx: ServiceContext,
  kind: SecretKind,
  plaintext: string,
): Promise<StoredSecret> {
  const id = crypto.randomUUID();
  const sealed = await deps.secretBox.seal(plaintext, { restaurantId: ctx.restaurantId, secretId: id, kind });
  await tx`
    insert into public.secrets (id, restaurant_id, kind, ciphertext, iv, wrapped_key, kek_version, last4)
    values (${id}, ${ctx.restaurantId}, ${kind}, ${sealed.ciphertext}, ${sealed.iv}, ${sealed.wrappedKey},
            ${sealed.kekVersion}, ${sealed.last4})
  `;
  await writeAudit(tx, ctx, {
    action: "secret.set",
    entityType: "secret",
    entityId: id,
    context: { kind, last4: sealed.last4 },
  });
  return { id, last4: sealed.last4 };
}

/** Deletes a secret that nothing references any more. */
export async function deleteSecret(tx: Tx, ctx: ServiceContext, id: string, kind: SecretKind): Promise<void> {
  await tx`delete from public.secrets where id = ${id} and restaurant_id = ${ctx.restaurantId}`;
  await writeAudit(tx, ctx, { action: "secret.delete", entityType: "secret", entityId: id, context: { kind } });
}

interface SecretRow {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  wrapped_key: Uint8Array;
  kek_version: number;
  last4: string;
}

/** Decrypts one secret for a server-side call. The caller must not return the value. */
export async function openSecret(
  tx: Tx,
  deps: ServiceDeps,
  ctx: ServiceContext,
  id: string,
  kind: SecretKind,
): Promise<string> {
  const [row] = await tx<SecretRow[]>`
    select ciphertext, iv, wrapped_key, kek_version, last4
    from public.secrets where id = ${id} and restaurant_id = ${ctx.restaurantId} and kind = ${kind}
  `;
  if (row === undefined) throw new AppError("not_found", "Secret not found.");
  return deps.secretBox.open(
    {
      ciphertext: row.ciphertext,
      iv: row.iv,
      wrappedKey: row.wrapped_key,
      kekVersion: row.kek_version,
      last4: row.last4,
    },
    { restaurantId: ctx.restaurantId, secretId: id, kind },
  );
}

/** Secret states by id, from the `secrets` table (last4 only). */
export async function secretStates(tx: Tx, ctx: ServiceContext, ids: readonly (string | null)[]) {
  const wanted = ids.filter((i): i is string => i !== null);
  const map = new Map<string, SecretState>();
  if (wanted.length === 0) return map;
  const rows = await tx<{ id: string; last4: string }[]>`
    select id, last4 from public.secrets where restaurant_id = ${ctx.restaurantId} and id in ${tx(wanted)}
  `;
  for (const r of rows) map.set(r.id, { configured: true, last4: r.last4 });
  return map;
}

/** One-line, bounded text from a gateway failure. Gateway errors never carry our secrets, but stay short anyway. */
export function shortError(error: string): string {
  return error.replace(/\s+/g, " ").trim().slice(0, 200);
}

/** URL rules: private hosts and http only outside production (ADR-017). */
export function urlRules(deps: ServiceDeps) {
  return { allowPrivateHosts: deps.allowPrivateHosts };
}
