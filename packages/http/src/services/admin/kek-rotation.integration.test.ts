// covers NFR-010, ADR-012 (07.security.md "Envelope encryption", KEK rotation)
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { EnvelopeSecretBox, type SecretKind } from "@mt/core";
import type { Db } from "@mt/db";
import { createTestDb, type RestaurantFixture, seedRestaurant } from "@mt/db/test-harness";

import { rewrapSecrets } from "./kek-rotation";

let db: Db;
let a: RestaurantFixture;
// Random keys, so rows that other tests sealed under the test KEK never unwrap here and stay put.
const oldKek = new Uint8Array(randomBytes(32));
const newKek = new Uint8Array(randomBytes(32));
const oldBox = new EnvelopeSecretBox({ kek: oldKek, kekVersion: 1 });
const rotatingBox = new EnvelopeSecretBox({ kek: newKek, kekVersion: 2, previous: { kek: oldKek, kekVersion: 1 } });
const newOnlyBox = new EnvelopeSecretBox({ kek: newKek, kekVersion: 2 });

async function insertSecret(box: EnvelopeSecretBox, plaintext: string, kind: SecretKind): Promise<string> {
  const id = randomUUID();
  const s = await box.seal(plaintext, { restaurantId: a.restaurantId, secretId: id, kind });
  await db`
    insert into public.secrets (id, restaurant_id, kind, ciphertext, iv, wrapped_key, kek_version, last4)
    values (${id}, ${a.restaurantId}, ${kind}, ${s.ciphertext}, ${s.iv}, ${s.wrappedKey}, ${s.kekVersion}, ${s.last4})`;
  return id;
}

async function openRow(box: EnvelopeSecretBox, id: string): Promise<string> {
  const [row] = await db<
    {
      kind: SecretKind;
      ciphertext: Uint8Array;
      iv: Uint8Array;
      wrapped_key: Uint8Array;
      kek_version: number;
      last4: string;
    }[]
  >`select kind, ciphertext, iv, wrapped_key, kek_version, last4 from public.secrets where id = ${id}`;
  if (!row) throw new Error("missing row");
  return box.open(
    {
      ciphertext: row.ciphertext,
      iv: row.iv,
      wrappedKey: row.wrapped_key,
      kekVersion: row.kek_version,
      last4: row.last4,
    },
    { restaurantId: a.restaurantId, secretId: id, kind: row.kind },
  );
}

beforeAll(async () => {
  db = await createTestDb();
  a = await seedRestaurant(db, "kek-rotation-a");
});

afterAll(async () => {
  await db.end();
});

describe("rewrapSecrets", () => {
  test("moves every row it can unwrap to the new KEK, payload unchanged, and a rerun is a no-op", async () => {
    const apiKey = await insertSecret(oldBox, "obk_live_abcdefghijklmnop", "uatis_api_key");
    const hook = await insertSecret(oldBox, "whsec_0123456789abcdef", "uatis_webhook_secret");

    const first = await rewrapSecrets(db, rotatingBox, 2);
    expect(first.failedIds).not.toContain(apiKey);
    expect(await openRow(newOnlyBox, apiKey)).toBe("obk_live_abcdefghijklmnop");
    expect(await openRow(newOnlyBox, hook)).toBe("whsec_0123456789abcdef");
    // The old KEK alone can no longer open them.
    await expect(openRow(oldBox, apiKey)).rejects.toThrow();

    const again = await rewrapSecrets(db, rotatingBox, 2);
    expect(again.failedIds).not.toContain(apiKey);
    const [row] = await db<{ kek_version: number }[]>`select kek_version from public.secrets where id = ${apiKey}`;
    expect(row?.kek_version).toBe(2);
  });

  test("a row under an unknown KEK is reported and left untouched", async () => {
    const strangerBox = new EnvelopeSecretBox({ kek: new Uint8Array(randomBytes(32)), kekVersion: 1 });
    const id = await insertSecret(strangerBox, "nfk_live_zyxwvutsrqponm", "webnf_api_key");
    const result = await rewrapSecrets(db, rotatingBox, 2);
    expect(result.failedIds).toContain(id);
    expect(result.remainingByVersion["1"]).toBeGreaterThan(0);
    expect(await openRow(strangerBox, id)).toBe("nfk_live_zyxwvutsrqponm");
  });
});
