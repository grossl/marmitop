// packages/db/src/migrate.integration.test.ts
//
// covers NFR-052
//
// The staging and production applier (11.operations.md "Migrations"): it
// applies every file once, records a checksum per file, applies nothing on a
// second run, and reports a changed file as drift. Runs against a throwaway
// database on the test cluster, created and dropped here.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDb, type Db } from "./client";
import { MIGRATIONS_DIR, readMigrations, runMigrations } from "./migrate";
import { DEFAULT_TEST_ADMIN_URL, prepareSupabaseSurface } from "./test-database";
import { testDatabaseUrl } from "./test-harness";

const DB_NAME = "mt_migrate_test";
const adminUrl = process.env.MT_TEST_ADMIN_URL ?? DEFAULT_TEST_ADMIN_URL;
let admin: Db;
let url = "";
let dir = "";

beforeAll(async () => {
  await testDatabaseUrl(); // fails with a clear message when the stack is down
  admin = createDb(adminUrl, { max: 1 });
  await admin.unsafe(`drop database if exists ${DB_NAME} with (force)`);
  await admin.unsafe(`create database ${DB_NAME}`);
  const parsed = new URL(adminUrl);
  parsed.pathname = `/${DB_NAME}`;
  url = parsed.toString();
  await prepareSupabaseSurface(url);
  dir = mkdtempSync(join(tmpdir(), "mt-migrations-"));
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
});

// The database drop can wait on a checkpoint while other suites run, so the hook gets 30 s.
afterAll(async () => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
  await admin?.unsafe(`drop database if exists ${DB_NAME} with (force)`);
  await admin?.end({ timeout: 5 });
}, 30_000);

test("applies every migration once, then nothing; a changed file is drift", async () => {
  const files = readMigrations(dir).map((f) => f.version);
  const quiet = { dir, log: () => {} };

  const first = await runMigrations(url, quiet);
  expect(first.applied).toEqual(files);
  expect(first.drifted).toEqual([]);

  const second = await runMigrations(url, quiet);
  expect(second.applied).toEqual([]);
  expect(second.skipped).toEqual(files);

  const last = files[files.length - 1] ?? "";
  writeFileSync(join(dir, last), "-- edited after it was applied\n", { flag: "a" });
  const third = await runMigrations(url, quiet);
  expect(third.drifted).toEqual([last]);
  expect(third.applied).toEqual([]);
});
