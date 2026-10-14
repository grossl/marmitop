#!/usr/bin/env bun
// packages/db/src/migrate.ts
//
// Applies pending migrations from supabase/migrations to a database and
// records them in public.schema_migrations, with a sha256 checksum per file
// and an advisory lock (11.operations.md "Migrations"). Staging and
// production use this runner; `supabase db reset` and scripts/test-db.ts are
// the other two appliers, each with its own ledger.
//
//   bun run --cwd packages/db migrate                     uses $MIGRATION_DATABASE_URL
//   bun packages/db/src/migrate.ts --url=postgres://...
//   bun packages/db/src/migrate.ts --dry-run
//
// The URL is an admin (migration owner) URL, never the app_service
// DATABASE_URL. Exit 2 means an applied file changed (checksum drift).
//
// Not re-exported from index.ts: it reads the filesystem relative to its own
// module path, which a bundler cannot follow. Import "@mt/db/migrate".

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

/** Where the .sql files live, resolved from this module, not from cwd. */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../../../supabase/migrations", import.meta.url));

const LOCK_ID = 7_412_300_001;
const FILE_NAME = /^[0-9]{4}_[a-z0-9_]+\.sql$/;

export interface MigrationFile {
  version: string;
  path: string;
  sql: string;
  checksum: string;
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
  /** Files whose contents changed after they were applied. */
  drifted: string[];
}

export function checksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

export function readMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => {
      if (!FILE_NAME.test(name)) throw new Error(`migration file name must match NNNN_name.sql: ${name}`);
      const path = join(dir, name);
      const sql = readFileSync(path, "utf8");
      return { version: name, path, sql, checksum: checksum(sql) };
    });
}

/**
 * Applies every migration not yet recorded. Each file runs in its own
 * transaction with its ledger row, so a failure leaves the database on the
 * last complete migration.
 */
export async function runMigrations(
  url: string,
  options: { dir?: string; dryRun?: boolean; log?: (message: string) => void } = {},
): Promise<MigrateResult> {
  const files = readMigrations(options.dir ?? MIGRATIONS_DIR);
  const log = options.log ?? ((message: string) => console.log(message));
  const result: MigrateResult = { applied: [], skipped: [], drifted: [] };

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`select pg_advisory_lock(${LOCK_ID})`;
    await sql`
      create table if not exists public.schema_migrations (
        version    text primary key,
        checksum   text not null,
        applied_at timestamptz not null default now()
      )
    `;
    await sql`revoke all on table public.schema_migrations from public`;

    const recorded = await sql<{ version: string; checksum: string }[]>`
      select version, checksum from public.schema_migrations
    `;
    const byVersion = new Map(recorded.map((row) => [row.version, row.checksum]));

    for (const file of files) {
      const known = byVersion.get(file.version);
      if (known !== undefined) {
        result.skipped.push(file.version);
        if (known !== file.checksum) {
          result.drifted.push(file.version);
          log(`! ${file.version} was applied with different contents (checksum drift)`);
        }
        continue;
      }
      if (options.dryRun === true) {
        log(`would apply ${file.version}`);
        result.applied.push(file.version);
        continue;
      }
      await sql.begin(async (tx) => {
        await tx.unsafe(file.sql).simple();
        await tx`insert into public.schema_migrations (version, checksum) values (${file.version}, ${file.checksum})`;
      });
      log(`applied ${file.version}`);
      result.applied.push(file.version);
    }
    return result;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  let url = process.env.MIGRATION_DATABASE_URL;
  let dryRun = false;
  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg.startsWith("--url=")) url = arg.slice("--url=".length);
  }
  if (url === undefined || url === "") {
    console.error("MIGRATION_DATABASE_URL is not set (or pass --url=postgres://...)");
    process.exit(1);
  }
  const result = await runMigrations(url, { dryRun });
  console.log(
    result.applied.length === 0
      ? `nothing to apply (${result.skipped.length} already recorded)`
      : `${result.applied.length} migration(s) ${dryRun ? "pending" : "applied"}`,
  );
  if (result.drifted.length > 0) {
    console.error(`checksum drift: ${result.drifted.join(", ")}`);
    process.exit(2);
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
