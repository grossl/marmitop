// KEK rotation, step 2 (07.security.md "Envelope encryption", 11.operations.md "KEK rotation").
// Run from a trusted shell, after the apps were deployed with the new MT_KEK, MT_KEK_VERSION, and
// MT_KEK_PREVIOUS:
//
//   MIGRATION_DATABASE_URL=postgres://postgres:...@.../postgres \
//   MT_KEK=<new> MT_KEK_VERSION=2 MT_KEK_PREVIOUS=<old> bun scripts/rewrap-secrets.ts
//
// It prints counts only, never a key or a secret. Exit 1 when a row could not be rewrapped.
// Safe to rerun. When only the new version remains, unset MT_KEK_PREVIOUS.

import { EnvelopeSecretBox, parseKek } from "../packages/core/src/secret-box";
import { createDb } from "../packages/db/src/client";
import { rewrapSecrets } from "../packages/http/src/services/admin/kek-rotation";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const url = process.env.MIGRATION_DATABASE_URL ?? fail("MIGRATION_DATABASE_URL is not set (the owner URL).");
const version = Number(process.env.MT_KEK_VERSION);
if (!Number.isInteger(version) || version < 2 || version > 32767)
  fail("MT_KEK_VERSION must be an integer of 2 or more.");
let kek: Uint8Array;
let previous: Uint8Array;
try {
  kek = parseKek(process.env.MT_KEK ?? "");
  previous = parseKek(process.env.MT_KEK_PREVIOUS ?? "");
} catch {
  fail("MT_KEK and MT_KEK_PREVIOUS must both be 32 bytes, base64.");
}

const box = new EnvelopeSecretBox({ kek, kekVersion: version, previous: { kek: previous, kekVersion: version - 1 } });
const db = createDb(url, { max: 1 });
try {
  const result = await rewrapSecrets(db, box, version);
  console.log(
    JSON.stringify({
      rewrapped: result.rewrapped,
      failed: result.failedIds.length,
      byVersion: result.remainingByVersion,
    }),
  );
  if (result.failedIds.length > 0) {
    console.error(`could not rewrap ${result.failedIds.length} row(s): ${result.failedIds.join(", ")}`);
    process.exitCode = 1;
  }
} finally {
  await db.end({ timeout: 5 });
}
