// packages/db/src/test-database.ts
//
// Builds the integration-test database (10.testing.md "Integration tests").
// scripts/test-db.ts is the command-line entry; test-harness.ts calls
// `ensureTestDatabase()` directly.
//
// Where the database lives:
//   * TEST_DATABASE_URL set (CI service container): used as-is, then
//     bootstrapped in place.
//   * otherwise: a separate database `mt_test` on the local Supabase stack's
//     cluster (`bun run dev:stack` or `supabase start`, port 54422). It is not
//     the dev database, so tests may truncate freely. The cluster already has
//     the Supabase roles and the pgmq extension package; pg_cron lives in the
//     `postgres` database only, so 0012 skips its schedules here.
//
// Steps: create the database if missing (or drop and recreate it when an
// applied migration file changed), load pgmq, create the auth stand-ins
// (auth.users and auth.uid()), apply every migration in order with ledger
// public._mt_test_migrations, and let the connecting role switch to
// app_service. Idempotent and serialized by an advisory lock.

import postgres from "postgres";

import { readMigrations } from "./migrate";

/** The local stack's cluster, as the migration owner (11.operations.md). */
export const DEFAULT_TEST_ADMIN_URL = "postgresql://postgres:postgres@127.0.0.1:54422/postgres";
export const TEST_DB_NAME = "mt_test";
const LOCK_ID = 7_412_300_002;

type Sql = postgres.Sql<Record<string, unknown>>;

function quiet(url: string): Sql {
  return postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 5 }) as unknown as Sql;
}

function withDatabase(adminUrl: string, database: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

export class TestDatabaseUnavailable extends Error {}

/** auth stand-ins. Supabase's real auth.uid() reads the same two settings. */
const AUTH_STANDINS = `
create schema if not exists auth;
create table if not exists auth.users (
  id         uuid primary key default gen_random_uuid(),
  email      text,
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid
language sql stable
as $fn$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$fn$;
grant usage on schema auth to authenticated, app_service;
grant execute on function auth.uid() to authenticated, app_service;
`;

async function needsRebuild(sql: Sql): Promise<boolean> {
  const [ledger] = await sql<{ exists: boolean }[]>`
    select to_regclass('public._mt_test_migrations') is not null as exists
  `;
  if (ledger?.exists !== true) return false;
  const applied = await sql<{ filename: string; checksum: string }[]>`
    select filename, checksum from public._mt_test_migrations
  `;
  const onDisk = new Map(readMigrations().map((file) => [file.version, file.checksum]));
  return applied.some((row) => onDisk.get(row.filename) !== row.checksum);
}

/**
 * The Supabase surface the migrations expect, in a database that is not a
 * Supabase one: the pgmq extension, the three roles, and the auth stand-ins.
 */
export async function prepareSupabaseSurface(url: string): Promise<void> {
  const sql = quiet(url);
  try {
    await sql.unsafe("create extension if not exists pgmq").simple();
    await sql
      .unsafe(`
      do $do$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
        if not exists (select 1 from pg_roles where rolname = 'app_service') then create role app_service nologin noinherit nobypassrls; end if;
      end $do$;
    `)
      .simple();
    await sql.unsafe(AUTH_STANDINS).simple();
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function bootstrap(url: string, log: (message: string) => void): Promise<void> {
  await prepareSupabaseSurface(url);
  const sql = quiet(url);
  try {
    await sql`
      create table if not exists public._mt_test_migrations (
        filename   text primary key,
        checksum   text not null,
        applied_at timestamptz not null default now()
      )
    `;
    const applied = new Set(
      (await sql<{ filename: string }[]>`select filename from public._mt_test_migrations`).map((r) => r.filename),
    );
    for (const file of readMigrations()) {
      if (applied.has(file.version)) continue;
      await sql.begin(async (tx) => {
        await tx.unsafe(file.sql).simple();
        await tx`insert into public._mt_test_migrations (filename, checksum) values (${file.version}, ${file.checksum})`;
      });
      log(`applied ${file.version}`);
    }
    // Tests connect as the migration owner and `set local role` to walk the
    // production paths. Postgres 16+ requires an explicit membership for that.
    await sql
      .unsafe(`
      do $do$
      declare
        v_role text;
      begin
        foreach v_role in array array['app_service', 'authenticated', 'anon'] loop
          if not pg_has_role(current_user, v_role, 'SET') then
            execute format('grant %I to %I', v_role, current_user);
          end if;
        end loop;
      end
      $do$;
    `)
      .simple();
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Returns a URL for a live, fully migrated test database. */
export async function ensureTestDatabase(
  options: { log?: (message: string) => void; adminUrl?: string } = {},
): Promise<string> {
  const log = options.log ?? (() => {});
  const fromEnv = process.env.TEST_DATABASE_URL;
  if (fromEnv !== undefined && fromEnv !== "") {
    await bootstrap(fromEnv, log);
    return fromEnv;
  }

  const adminUrl = options.adminUrl ?? process.env.MT_TEST_ADMIN_URL ?? DEFAULT_TEST_ADMIN_URL;
  const admin = quiet(adminUrl);
  try {
    try {
      await admin`select 1`;
    } catch (error) {
      throw new TestDatabaseUnavailable(
        `cannot reach the test cluster at ${new URL(adminUrl).host} (${(error as Error).message}). ` +
          "Start the local stack with `bun run dev:stack` (or `supabase start`), or set TEST_DATABASE_URL.",
      );
    }
    await admin`select pg_advisory_lock(${LOCK_ID})`;
    const testUrl = withDatabase(adminUrl, TEST_DB_NAME);

    const [exists] = await admin<{ exists: boolean }[]>`
      select exists (select 1 from pg_database where datname = ${TEST_DB_NAME}) as exists
    `;
    let create = exists?.exists !== true;
    if (!create) {
      const probe = quiet(testUrl);
      try {
        if (await needsRebuild(probe)) {
          log(`an applied migration changed: rebuilding ${TEST_DB_NAME}`);
          create = true;
        }
      } finally {
        await probe.end({ timeout: 5 });
      }
      if (create) await admin.unsafe(`drop database ${TEST_DB_NAME} with (force)`);
    }
    if (create) {
      await admin.unsafe(`create database ${TEST_DB_NAME}`);
      log(`created database ${TEST_DB_NAME}`);
    }

    await bootstrap(testUrl, log);
    await admin`select pg_advisory_unlock(${LOCK_ID})`;
    return testUrl;
  } finally {
    await admin.end({ timeout: 5 });
  }
}
