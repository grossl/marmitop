-- 0027_public_menu_orders.sql
--
-- Orders from the public menu (ADR-031, FR-230–237, 05.data-model.md
-- "orders", "Functions"). Forward-only (NFR-062).
--
-- 1. orders.source accepts 'menu'.
-- 2. rate_counters.class accepts 'menu_order' (FR-235).
-- 3. mt.public_menu also returns allow_pickup, delivery_fee_cents, and the
--    business hours, so the page can show the fee and "Fechado agora".
-- 4. mt.public_restaurant_id: the internal id for a public_id. Only the
--    server calls it, as app_service, before the system context exists.

alter table public.orders drop constraint if exists orders_source;
alter table public.orders add constraint orders_source
  check (source in ('counter', 'phone', 'whatsapp', 'api', 'menu'));

alter table public.rate_counters drop constraint if exists rate_counters_class_check;
alter table public.rate_counters add constraint rate_counters_class_check
  check (class in ('read', 'write', 'webhook', 'menu_order'));

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
    'allow_pickup', coalesce(s.allow_pickup, true),
    'delivery_fee_cents', coalesce(s.delivery_fee_cents, 0),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object(
          'weekday', h.weekday,
          'enabled', h.enabled,
          'opens_at', h.opens_at::text,
          'closes_at', h.closes_at::text
        ) order by h.weekday)
      from public.business_hours h
      where h.restaurant_id = r.id
    ), '[]'::jsonb),
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
            select jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'price_cents', z.price_cents)
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

create or replace function mt.public_restaurant_id(p_public_id text)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select r.id from public.restaurants r where r.public_id = p_public_id
$fn$;

revoke all on function mt.public_restaurant_id(text) from public;
grant execute on function mt.public_restaurant_id(text) to app_service;
