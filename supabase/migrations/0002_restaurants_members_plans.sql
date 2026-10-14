-- 0002_restaurants_members_plans.sql
--
-- plans, restaurants, restaurant_members and the membership and role helpers
-- every later policy depends on (05.data-model.md, ADR-005). FR-001–009,
-- FR-080.

-- ---------------------------------------------------------------------------
-- plans (platform-global, no restaurant_id)
-- ---------------------------------------------------------------------------

create table if not exists public.plans (
  code                    text primary key,
  name                    text not null,
  included_orders_month   integer not null check (included_orders_month >= 0),
  included_messages_month integer not null check (included_messages_month >= 0),
  included_invoices_month integer not null check (included_invoices_month >= 0),
  price_display           text not null default ''
);

comment on table public.plans is 'Plan catalogue (05.data-model.md). Display only in v1; nothing charges (ADR-008).';

insert into public.plans (code, name, included_orders_month, included_messages_month, included_invoices_month, price_display)
values
  ('free', 'Free', 300, 1000, 100, 'R$ 0'),
  ('pro', 'Pro', 5000, 20000, 3000, 'R$ 149/mês')
on conflict (code) do nothing;

alter table public.plans enable row level security;
alter table public.plans force row level security;
revoke all on table public.plans from public;
do $do$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on table public.plans from %I', v_role);
    end if;
  end loop;
end
$do$;
grant select on table public.plans to app_service;
create policy plans_service_select on public.plans for select to app_service using (true);

-- ---------------------------------------------------------------------------
-- restaurants
-- ---------------------------------------------------------------------------

create table if not exists public.restaurants (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(name) between 1 and 120),
  phone            text,
  email            text,
  address          text,
  cidade           text,
  uf               text check (uf ~ '^[A-Z]{2}$'),
  codigo_municipio text check (codigo_municipio ~ '^[0-9]{7}$'),
  plan_code        text not null default 'free' references public.plans(code),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger restaurants_set_updated_at
  before update on public.restaurants
  for each row execute function mt.set_updated_at();

-- ---------------------------------------------------------------------------
-- restaurant_members
-- ---------------------------------------------------------------------------

create table if not exists public.restaurant_members (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null check (role in ('admin', 'attendant')),
  created_at    timestamptz not null default now(),
  unique (restaurant_id, user_id)
);

create index if not exists restaurant_members_user_idx on public.restaurant_members (user_id);

-- ---------------------------------------------------------------------------
-- Membership and role helpers (05.data-model.md "Helper functions")
-- ---------------------------------------------------------------------------
-- Security definer functions run as the migration owner, which bypasses RLS,
-- so policies on restaurant_members can ask about restaurant_members without
-- recursing.

create or replace function mt.user_restaurant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select m.restaurant_id from public.restaurant_members m where m.user_id = auth.uid()
$fn$;

-- User path first (auth.uid()), service path second (app.user_id). A browser
-- session always carries auth.uid(), so it cannot reach the second branch.
create or replace function mt.is_member(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select exists (
    select 1 from public.restaurant_members m
    where m.restaurant_id = p_restaurant_id
      and m.user_id = coalesce(auth.uid(), nullif(pg_catalog.current_setting('app.user_id', true), '')::uuid)
  )
$fn$;

create or replace function mt.is_admin(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select exists (
    select 1 from public.restaurant_members m
    where m.restaurant_id = p_restaurant_id
      and m.role = 'admin'
      and m.user_id = coalesce(auth.uid(), nullif(pg_catalog.current_setting('app.user_id', true), '')::uuid)
  )
$fn$;

-- The role comes from data, never from a setting code can write freely.
-- plpgsql, because public.api_keys arrives in 0004.
create or replace function mt.actor_role()
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_restaurant uuid := mt.current_restaurant_id();
  v_actor text := mt.current_actor_type();
  v_role text;
begin
  if v_restaurant is null then
    return null;
  end if;

  if v_actor = 'user' then
    select m.role into v_role
    from public.restaurant_members m
    where m.restaurant_id = v_restaurant
      and m.user_id = mt.current_user_id();
    return v_role;
  elsif v_actor = 'api_key' then
    if exists (
      select 1 from public.api_keys k
      where k.id = mt.current_api_key_id()
        and k.restaurant_id = v_restaurant
        and k.revoked_at is null
    ) then
      return 'attendant';
    end if;
    return null;
  elsif v_actor = 'system' then
    return 'admin';
  end if;

  return null;
end
$fn$;

create or replace function mt.can_write(p_min_role text)
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $fn$
  select coalesce(
    case p_min_role
      when 'attendant' then mt.actor_role() in ('attendant', 'admin')
      when 'admin' then mt.actor_role() = 'admin'
      else false
    end,
    false
  )
$fn$;

create or replace function mt.memberships_for_user(p_user_id uuid)
returns table (restaurant_id uuid, role text)
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select m.restaurant_id, m.role
  from public.restaurant_members m
  where m.user_id = p_user_id
  order by m.created_at, m.restaurant_id
$fn$;

-- Onboarding: a restaurant, its first admin and its settings row in one call
-- (05.data-model.md "Notes"). restaurants has no insert grant on any path.
create or replace function mt.create_restaurant(p_name text, p_owner_user_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_id uuid;
begin
  if p_owner_user_id is null then
    raise exception 'mt.create_restaurant: owner_user_id is required' using errcode = '22004';
  end if;

  insert into public.restaurants (name) values (p_name) returning id into v_id;
  insert into public.restaurant_members (restaurant_id, user_id, role) values (v_id, p_owner_user_id, 'admin');
  insert into public.restaurant_settings (restaurant_id) values (v_id);
  return v_id;
end
$fn$;

revoke all on function mt.user_restaurant_ids() from public;
revoke all on function mt.is_member(uuid) from public;
revoke all on function mt.is_admin(uuid) from public;
revoke all on function mt.actor_role() from public;
revoke all on function mt.can_write(text) from public;
revoke all on function mt.memberships_for_user(uuid) from public;
revoke all on function mt.create_restaurant(text, uuid) from public;

grant execute on function mt.user_restaurant_ids() to authenticated;
grant execute on function mt.is_member(uuid) to authenticated, app_service;
grant execute on function mt.is_admin(uuid) to authenticated, app_service;
grant execute on function mt.actor_role() to app_service;
grant execute on function mt.can_write(text) to app_service;
grant execute on function mt.memberships_for_user(uuid) to app_service;
grant execute on function mt.create_restaurant(text, uuid) to app_service;

-- ---------------------------------------------------------------------------
-- Last-admin guard
-- ---------------------------------------------------------------------------
-- A restaurant always keeps one admin. A cascade from deleting the restaurant
-- itself passes: the parent row is already gone when the cascade runs.

create or replace function mt.restaurant_members_keep_admin()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if old.role <> 'admin' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' and new.role = 'admin' and new.restaurant_id = old.restaurant_id then
    return new;
  end if;
  if not exists (select 1 from public.restaurants r where r.id = old.restaurant_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if not exists (
    select 1 from public.restaurant_members m
    where m.restaurant_id = old.restaurant_id
      and m.role = 'admin'
      and m.id <> old.id
  ) then
    raise exception 'restaurant % must keep at least one admin', old.restaurant_id
      using errcode = '23514', constraint = 'restaurant_members_last_admin';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$fn$;

revoke all on function mt.restaurant_members_keep_admin() from public;

create trigger restaurant_members_keep_admin
  before update or delete on public.restaurant_members
  for each row execute function mt.restaurant_members_keep_admin();

-- ---------------------------------------------------------------------------
-- RLS (05.data-model.md "Role rules")
-- ---------------------------------------------------------------------------

select mt.apply_tenant_policies('restaurants', 'member', null, 'admin', null, 'id');

-- Column grant: id and plan_code are not writable on any path. Plan changes
-- come from the billing adapter through a definer function (ADR-008).
revoke update on table public.restaurants from app_service;
grant update (name, phone, email, address, cidade, uf, codigo_municipio, updated_at)
  on table public.restaurants to app_service;

select mt.apply_tenant_policies('restaurant_members', 'member', 'admin', 'admin', 'admin');
