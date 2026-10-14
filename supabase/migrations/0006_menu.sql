-- 0006_menu.sql
--
-- menu_items, menu_item_sizes (05.data-model.md, ADR-006). FR-050–059.

create table if not exists public.menu_items (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references public.restaurants(id) on delete cascade,
  kind               text not null check (kind in ('meal', 'drink')),
  name               text not null check (char_length(name) between 1 and 120),
  description        text check (char_length(description) <= 500),
  category           text not null,
  price_cents        bigint not null check (price_cents >= 0),
  calories           integer check (calories >= 0),
  volume             text,
  available          boolean not null default true,
  popular            boolean not null default false,
  available_weekdays smallint[] not null default '{0,1,2,3,4,5,6}'
                     check (available_weekdays <@ '{0,1,2,3,4,5,6}'::smallint[]),
  image_url          text,
  ncm                text check (ncm ~ '^[0-9]{8}$'),
  cfop               text check (cfop ~ '^[0-9]{4}$'),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint menu_items_category_kind check (
    (kind = 'meal' and category in ('proteinas', 'vegetariano', 'fit', 'executiva', 'especial'))
    or (kind = 'drink' and category in ('refrigerantes', 'sucos', 'agua', 'alcoolicas', 'quentes'))
  ),
  constraint menu_items_calories_meal_only check (kind = 'meal' or calories is null),
  constraint menu_items_volume_drink_only check (kind = 'drink' or volume is null)
);

create index if not exists menu_items_restaurant_kind_category_idx
  on public.menu_items (restaurant_id, kind, category);

create trigger menu_items_set_updated_at
  before update on public.menu_items
  for each row execute function mt.set_updated_at();

select mt.apply_tenant_policies('menu_items', 'member', 'admin', 'admin', 'admin');

-- ---------------------------------------------------------------------------

create table if not exists public.menu_item_sizes (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  menu_item_id  uuid not null references public.menu_items(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 40),
  price_cents   bigint not null check (price_cents >= 0),
  position      smallint not null default 0,
  constraint menu_item_sizes_item_name_key unique (menu_item_id, name)
);

select mt.apply_tenant_policies('menu_item_sizes', 'member', 'admin', 'admin', 'admin');
