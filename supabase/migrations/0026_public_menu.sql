-- 0026_public_menu.sql
--
-- The public menu page /m/{public_id} (ADR-030, FR-220–225,
-- 05.data-model.md "restaurants", "Functions").
--
-- 1. restaurants.public_id: the external id of a restaurant. Public links use
--    it, never the internal id. 12 lowercase hex characters (48 random bits),
--    set by a default on insert, backfilled here, and never changed.
-- 2. mt.public_menu: the page has no session and no restaurant context. This
--    definer function is its only read: one fixed result with the public
--    columns, never ncm, cfop, the internal restaurant id, or another
--    restaurant's rows. Unavailable and archived items are left out.

create or replace function mt.new_public_id()
returns text
language sql
volatile
set search_path = pg_catalog, pg_temp
as $fn$
  select substr(md5(gen_random_uuid()::text), 1, 12)
$fn$;

-- Column defaults run as the inserting role: the owner (seed, migrations) or
-- the definer mt.create_restaurant. No other role needs it.
revoke all on function mt.new_public_id() from public;

alter table public.restaurants add column if not exists public_id text;
update public.restaurants set public_id = mt.new_public_id() where public_id is null;
alter table public.restaurants
  alter column public_id set default mt.new_public_id(),
  alter column public_id set not null;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'restaurants_public_id_key') then
    alter table public.restaurants add constraint restaurants_public_id_key unique (public_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'restaurants_public_id_format') then
    alter table public.restaurants add constraint restaurants_public_id_format check (public_id ~ '^[0-9a-f]{12}$');
  end if;
end
$do$;

-- Shared links must keep working: the external id never changes (FR-225).
create or replace function mt.restaurants_public_id_fixed()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if new.public_id is distinct from old.public_id then
    raise exception 'restaurants.public_id cannot change' using errcode = 'P0001';
  end if;
  return new;
end
$fn$;

revoke all on function mt.restaurants_public_id_fixed() from public;

drop trigger if exists restaurants_public_id_fixed on public.restaurants;
create trigger restaurants_public_id_fixed
  before update of public_id on public.restaurants
  for each row execute function mt.restaurants_public_id_fixed();

create or replace function mt.public_menu(p_public_id text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select jsonb_build_object(
    'name', r.name,
    'phone', r.phone,
    'timezone', coalesce(s.timezone, 'America/Sao_Paulo'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', i.id,
          'kind', i.kind,
          'name', i.name,
          'description', i.description,
          'category', i.category,
          'price_cents', i.price_cents,
          'calories', i.calories,
          'volume', i.volume,
          'popular', i.popular,
          'available_weekdays', to_jsonb(i.available_weekdays),
          'image_url', i.image_url,
          'sizes', coalesce((
            select jsonb_agg(jsonb_build_object('name', z.name, 'price_cents', z.price_cents)
                             order by z.position, z.name)
            from public.menu_item_sizes z
            where z.restaurant_id = r.id and z.menu_item_id = i.id
          ), '[]'::jsonb)
        ) order by i.popular desc, i.name, i.id)
      from public.menu_items i
      where i.restaurant_id = r.id and i.available and i.archived_at is null
    ), '[]'::jsonb)
  )
  from public.restaurants r
  left join public.restaurant_settings s on s.restaurant_id = r.id
  where r.public_id = p_public_id
$fn$;

revoke all on function mt.public_menu(text) from public;
grant execute on function mt.public_menu(text) to app_service;
