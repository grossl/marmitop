-- 0001_roles_schema_helpers.sql
--
-- Roles, schema `mt`, the service-context helpers and the policy builder every
-- tenant table uses (05.data-model.md "Access model", ADR-005, ADR-017).
--
-- Portability contract:
--   * the local Supabase stack, where `anon` and `authenticated` exist and the
--     `auth` schema belongs to supabase_auth_admin;
--   * the integration-test database, where scripts/test-db.ts has created an
--     `auth` stand-in (auth.users + auth.uid()).
-- Therefore: never create the `auth` schema, guard every role, and turn
-- privilege errors on objects we may not own into warnings.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
-- `app_service` is the only role apps/api, apps/worker and the dashboard server
-- use. It is `nobypassrls`, so every row it touches passes a policy. It is
-- `nologin` here; each environment attaches a password out of band (the local
-- seed does it for the dev stack, 11.operations.md).

do $do$
declare
  v_is_super boolean := coalesce((select rolsuper from pg_roles where rolname = current_user), false);
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_service') then
    create role app_service nologin noinherit nobypassrls;
  end if;

  if (select rolbypassrls from pg_roles where rolname = 'app_service') then
    if v_is_super then
      alter role app_service nobypassrls;
    else
      raise warning 'app_service has BYPASSRLS and % cannot remove it; ADR-005 requires NOBYPASSRLS', current_user;
    end if;
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- Schema grants and default privileges
-- ---------------------------------------------------------------------------

grant usage on schema public to app_service;

create schema if not exists mt;
revoke all on schema mt from public;
-- `authenticated` needs usage on `mt` for the Realtime select policies
-- (mt.user_restaurant_ids) and the storage policies (mt.is_admin).
grant usage on schema mt to app_service, authenticated;

-- Supabase grants ALL on every new table, sequence and function in `public`
-- to anon, authenticated and service_role through default privileges. ADR-017
-- gives `authenticated` no write grant on any table, so the defaults this
-- migration owner would hand out are removed here. Each table migration also
-- revokes explicitly (mt.apply_tenant_policies), so the rule does not depend
-- on this block alone.
do $do$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('alter default privileges in schema public revoke all on tables from %I', v_role);
      execute format('alter default privileges in schema public revoke all on sequences from %I', v_role);
      execute format('alter default privileges in schema public revoke all on functions from %I', v_role);
    end if;
  end loop;
exception
  when insufficient_privilege then
    raise warning 'could not change default privileges (%); table migrations still revoke explicitly', sqlerrm;
end
$do$;

-- Policies call auth.uid(), which needs usage on schema auth.
do $do$
begin
  if not has_schema_privilege('authenticated', 'auth', 'usage') then
    execute 'grant usage on schema auth to authenticated';
  end if;
exception
  when insufficient_privilege then
    raise warning 'could not grant usage on schema auth (%); check the grant exists already', sqlerrm;
end
$do$;

-- ---------------------------------------------------------------------------
-- Service context (05.data-model.md "Service context")
-- ---------------------------------------------------------------------------
-- A missing setting reads as null, and every policy then matches zero rows.

create or replace function mt.current_restaurant_id()
returns uuid
language sql
stable
set search_path = pg_catalog, pg_temp
as $fn$
  select nullif(pg_catalog.current_setting('app.restaurant_id', true), '')::uuid
$fn$;

create or replace function mt.current_user_id()
returns uuid
language sql
stable
set search_path = pg_catalog, pg_temp
as $fn$
  select nullif(pg_catalog.current_setting('app.user_id', true), '')::uuid
$fn$;

create or replace function mt.current_actor_type()
returns text
language sql
stable
set search_path = pg_catalog, pg_temp
as $fn$
  select nullif(pg_catalog.current_setting('app.actor_type', true), '')
$fn$;

-- Internal: the api key behind an `api_key` actor. mt.actor_role() reads it.
create or replace function mt.current_api_key_id()
returns uuid
language sql
stable
set search_path = pg_catalog, pg_temp
as $fn$
  select nullif(pg_catalog.current_setting('app.api_key_id', true), '')::uuid
$fn$;

create or replace function mt.set_context(
  p_restaurant_id uuid,
  p_actor_type text,
  p_user_id uuid default null,
  p_api_key_id uuid default null
)
returns void
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if p_restaurant_id is null then
    raise exception 'mt.set_context: restaurant_id is required' using errcode = '22004';
  end if;
  if p_actor_type is null or p_actor_type not in ('user', 'api_key', 'system') then
    raise exception 'mt.set_context: unknown actor_type %', coalesce(p_actor_type, '(null)') using errcode = '22023';
  end if;

  perform pg_catalog.set_config('app.restaurant_id', p_restaurant_id::text, true);
  perform pg_catalog.set_config('app.actor_type', p_actor_type, true);
  perform pg_catalog.set_config('app.user_id', coalesce(p_user_id::text, ''), true);
  perform pg_catalog.set_config('app.api_key_id', coalesce(p_api_key_id::text, ''), true);
end
$fn$;

comment on function mt.set_context(uuid, text, uuid, uuid) is
  'Sets app.restaurant_id, app.actor_type, app.user_id and app.api_key_id for the current transaction only (05.data-model.md "Service context").';

create or replace function mt.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $fn$
begin
  new.updated_at := pg_catalog.now();
  return new;
end
$fn$;

revoke all on function mt.current_restaurant_id() from public;
revoke all on function mt.current_user_id() from public;
revoke all on function mt.current_actor_type() from public;
revoke all on function mt.current_api_key_id() from public;
revoke all on function mt.set_context(uuid, text, uuid, uuid) from public;
revoke all on function mt.set_updated_at() from public;

grant execute on function mt.current_restaurant_id() to app_service;
grant execute on function mt.current_user_id() to app_service;
grant execute on function mt.current_actor_type() to app_service;
grant execute on function mt.current_api_key_id() to app_service;
grant execute on function mt.set_context(uuid, text, uuid, uuid) to app_service;

-- ---------------------------------------------------------------------------
-- Policy builder (migration tooling, owner only)
-- ---------------------------------------------------------------------------
-- Applies the 05.data-model.md "Policy pattern" to one table: RLS enabled and
-- forced, every grant to anon/authenticated/service_role removed, and one
-- policy plus one grant per command on app_service.
--
--   p_select: 'member' (any non-null actor role) | 'admin' | null (no grant)
--   p_insert, p_update, p_delete: 'attendant' | 'admin' | null (no grant)
--   p_tenant_col: the column that holds the tenant id ('id' on restaurants)
--
-- The role checks call mt.actor_role() and mt.can_write(), created in 0002.
-- Policy expressions wrap them in scalar subqueries so Postgres evaluates them
-- once per statement, not once per row.

create or replace function mt.apply_tenant_policies(
  p_table text,
  p_select text,
  p_insert text,
  p_update text,
  p_delete text,
  p_tenant_col text default 'restaurant_id'
)
returns void
language plpgsql
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_rel text := format('public.%I', p_table);
  v_tenant text := format('%I = (select mt.current_restaurant_id())', p_tenant_col);
  v_role text;
  v_read text;
begin
  if p_select is not null and p_select not in ('member', 'admin') then
    raise exception 'apply_tenant_policies(%): bad select role %', p_table, p_select;
  end if;
  if coalesce(p_insert, 'admin') not in ('attendant', 'admin')
     or coalesce(p_update, 'admin') not in ('attendant', 'admin')
     or coalesce(p_delete, 'admin') not in ('attendant', 'admin') then
    raise exception 'apply_tenant_policies(%): bad write role', p_table;
  end if;

  execute format('alter table %s enable row level security', v_rel);
  execute format('alter table %s force row level security', v_rel);

  foreach v_role in array array['public', 'anon', 'authenticated', 'service_role', 'app_service'] loop
    if v_role = 'public' or exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on table %s from %s', v_rel, case when v_role = 'public' then 'public' else quote_ident(v_role) end);
    end if;
  end loop;

  if p_select is not null then
    v_read := case p_select
      when 'member' then '(select mt.actor_role()) is not null'
      else '(select mt.actor_role()) = ''admin'''
    end;
    execute format('grant select on table %s to app_service', v_rel);
    execute format(
      'create policy %I on %s for select to app_service using (%s and %s)',
      p_table || '_service_select', v_rel, v_tenant, v_read
    );
  end if;

  if p_insert is not null then
    execute format('grant insert on table %s to app_service', v_rel);
    execute format(
      'create policy %I on %s for insert to app_service with check (%s and (select mt.can_write(%L)))',
      p_table || '_service_insert', v_rel, v_tenant, p_insert
    );
  end if;

  if p_update is not null then
    execute format('grant update on table %s to app_service', v_rel);
    execute format(
      'create policy %I on %s for update to app_service using (%s and (select mt.can_write(%L))) with check (%s and (select mt.can_write(%L)))',
      p_table || '_service_update', v_rel, v_tenant, p_update, v_tenant, p_update
    );
  end if;

  if p_delete is not null then
    execute format('grant delete on table %s to app_service', v_rel);
    execute format(
      'create policy %I on %s for delete to app_service using (%s and (select mt.can_write(%L)))',
      p_table || '_service_delete', v_rel, v_tenant, p_delete
    );
  end if;
end
$fn$;

revoke all on function mt.apply_tenant_policies(text, text, text, text, text, text) from public;
