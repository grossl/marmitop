// KEK rotation, step 2 (07.security.md "Envelope encryption", ADR-012): wrap every data key in
// `secrets` again under the current KEK. Payloads, ivs, and last4 do not change.
//
// Runs as the migration owner, from a trusted shell, like the migration runner: `app_service`
// has no update policy on `secrets` (secrets are write-once from the apps). One transaction per
// row, so a crash leaves each row on either the old or the new KEK, never half done, and a
// rerun picks up where it stopped. Never logs or returns key material.

import type { EnvelopeSecretBox, SecretKind } from "@mt/core";
import type { Db } from "@mt/db";

export interface RewrapResult {
  /** Rows now on the target version. */
  readonly rewrapped: number;
  /** Ids of rows whose data key could not be unwrapped (wrong or missing previous KEK). */
  readonly failedIds: readonly string[];
  /** Rows per `kek_version` after the run. Rotation is done when only the target remains. */
  readonly remainingByVersion: Readonly<Record<string, number>>;
}

interface Row {
  id: string;
  restaurant_id: string;
  kind: SecretKind;
  ciphertext: Uint8Array;
  iv: Uint8Array;
  wrapped_key: Uint8Array;
  kek_version: number;
  last4: string;
}

export async function rewrapSecrets(db: Db, box: EnvelopeSecretBox, targetVersion: number): Promise<RewrapResult> {
  const pending = await db<{ id: string }[]>`
    select id from public.secrets where kek_version <> ${targetVersion} order by id`;
  let rewrapped = 0;
  const failedIds: string[] = [];
  for (const { id } of pending) {
    const done = await db
      .begin(async (tx) => {
        const [row] = await tx<Row[]>`
        select id, restaurant_id, kind, ciphertext, iv, wrapped_key, kek_version, last4
        from public.secrets where id = ${id} and kek_version <> ${targetVersion} for update`;
        if (row === undefined) return false; // already rewrapped by a concurrent run
        const next = await box.rewrap(
          {
            ciphertext: row.ciphertext,
            iv: row.iv,
            wrappedKey: row.wrapped_key,
            kekVersion: row.kek_version,
            last4: row.last4,
          },
          { restaurantId: row.restaurant_id, secretId: row.id, kind: row.kind },
        );
        await tx`
        update public.secrets set wrapped_key = ${next.wrappedKey}, kek_version = ${next.kekVersion}
        where id = ${row.id}`;
        return true;
      })
      .catch(() => {
        failedIds.push(id);
        return false;
      });
    if (done) rewrapped += 1;
  }
  const counts = await db<{ kek_version: number; n: number }[]>`
    select kek_version, count(*)::int as n from public.secrets group by kek_version order by kek_version`;
  const remainingByVersion = Object.fromEntries(counts.map((c) => [String(c.kek_version), c.n]));
  return { rewrapped, failedIds, remainingByVersion };
}
