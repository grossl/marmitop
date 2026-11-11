-- scripts/provision/production.sql
--
-- One-time setup of a hosted Supabase project for Marmitop (11.operations.md "Migrations",
-- "Per-environment provisioning outside migrations"). Run it in the Supabase SQL editor, as
-- `postgres`, AFTER `bun run --cwd packages/db migrate` applied every migration.
--
-- Never run supabase/seed.sql on a hosted project: it holds fixed development logins.
--
-- Before you run it, replace CHANGE_ME below with a long random password, for example
-- `openssl rand -base64 32`. Store it only in the hosts' secret stores, inside DATABASE_URL:
--   postgresql://app_service.<project-ref>:<password>@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require

-- 1. Let the apps log in as app_service. Migration 0001 created it nologin, nobypassrls.
do $do$
begin
  if 'CHANGE_ME' = 'CHANGE_ME' then
    raise exception 'replace CHANGE_ME with the app_service password first';
  end if;
end
$do$;
alter role app_service with login password 'CHANGE_ME';

-- 2. Realtime: migrations 0013 and 0017 add these tables when they can. Add any that are missing.
do $do$
declare
  v_table text;
begin
  foreach v_table in array array['orders', 'messages', 'conversations', 'order_invoices'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end
$do$;

-- 3. Checks. Every row must say ok = true.
select 'app_service can log in, cannot bypass RLS' as check,
       (rolcanlogin and not rolbypassrls and not rolsuper) as ok
  from pg_roles where rolname = 'app_service'
union all
select 'realtime publishes the 4 tables',
       count(*) = 4
  from pg_publication_tables
 where pubname = 'supabase_realtime' and schemaname = 'public'
   and tablename in ('orders', 'messages', 'conversations', 'order_invoices')
union all
select 'pg_cron runs the 11 Marmitop jobs under one user',
       count(*) = 11 and count(distinct username) = 1
  from cron.job where jobname like 'mt\_%'
union all
select 'the 4 pgmq queues exist',
       count(*) = 4
  from pgmq.list_queues()
 where queue_name in ('mt_outbound_messages', 'mt_webhook_deliveries', 'mt_invoice_jobs', 'mt_sync')
union all
select 'every public table has RLS forced',
       bool_and(c.relrowsecurity and c.relforcerowsecurity)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and c.relname not like '\_mt%' and c.relname <> 'schema_migrations'
union all
select 'no dev seed logins exist',
       not exists (select 1 from auth.users where email like '%@qwe.com' or email like '%.test');
