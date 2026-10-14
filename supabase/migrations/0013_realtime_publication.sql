-- 0013_realtime_publication.sql
--
-- Adds orders, messages and conversations to the supabase_realtime
-- publication (05.data-model.md "Realtime publication", ADR-004). Realtime
-- checks each change against the `authenticated` select policy, so a user
-- receives events only for restaurants where they are a member.
--
-- Skipped when the publication does not exist (the integration-test
-- database). Hosted projects without it add the tables by hand
-- (11.operations.md "Migrations").

do $do$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'publication supabase_realtime not found: skipping (expected on the integration-test database)';
    return;
  end if;

  foreach v_table in array array['orders', 'messages', 'conversations'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
exception
  when insufficient_privilege then
    raise warning 'could not alter publication supabase_realtime (%): add the tables by hand', sqlerrm;
end
$do$;
