-- 0000_supabase_extensions.sql
--
-- Extensions the schema depends on: pgmq (queues, ADR-007), pg_cron
-- (schedules, migration 0012) and pg_trgm (search indexes on customers and
-- orders). 05.data-model.md "Migration files".
--
-- Portability contract (10.testing.md "Integration tests"):
--   * the local Supabase stack, where all three are installable;
--   * the integration-test database, a second database on the same cluster
--     where pg_cron cannot be created (pg_cron lives in one database only).
-- Therefore: guard on schema presence and turn every failure into a warning.
-- Later migrations skip what needs a missing extension.

-- pg_trgm goes into `extensions`, the Supabase convention. Indexes name the
-- operator class as `extensions.gin_trgm_ops`, so they do not depend on the
-- search_path the applier uses.
create schema if not exists extensions;

do $do$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    create extension pg_trgm with schema extensions;
  end if;
exception
  when others then
    raise warning 'could not create the pg_trgm extension (%): search indexes will fail', sqlerrm;
end
$do$;

do $do$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'pgmq') then
    begin
      create extension if not exists pgmq;
    exception
      when others then
        raise warning 'could not create the pgmq extension (%): queue objects in 0012 will fail', sqlerrm;
    end;
  end if;
end
$do$;

do $do$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'cron') then
    begin
      create extension if not exists pg_cron;
    exception
      when others then
        raise warning 'could not create the pg_cron extension (%): 0012 will skip its schedules', sqlerrm;
    end;
  end if;
end
$do$;
