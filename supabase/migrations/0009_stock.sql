-- 0009_stock.sql
--
-- stock_items, stock_movements and the movement trigger (05.data-model.md).
-- FR-060–069.

create table if not exists public.stock_items (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 120),
  unit            text not null check (char_length(unit) between 1 and 10),
  category        text not null check (category in ('insumos', 'embalagens', 'bebidas')),
  current_qty     numeric(12,3) not null default 0 check (current_qty >= 0),
  minimum_qty     numeric(12,3) not null default 0 check (minimum_qty >= 0),
  unit_cost_cents bigint not null default 0 check (unit_cost_cents >= 0),
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint stock_items_restaurant_id_id_key unique (restaurant_id, id)
);

create trigger stock_items_set_updated_at
  before update on public.stock_items
  for each row execute function mt.set_updated_at();

-- No delete grant: an item leaves the lists through archived_at (ADR-018).
select mt.apply_tenant_policies('stock_items', 'member', 'admin', 'admin', null);

-- current_qty is not writable by an update: only the movement trigger below
-- changes it, so every quantity change leaves a stock_movements row.
revoke update on table public.stock_items from app_service;
grant update (name, unit, category, minimum_qty, unit_cost_cents, archived_at, updated_at)
  on table public.stock_items to app_service;

-- ---------------------------------------------------------------------------
-- stock_movements (append-only)
-- ---------------------------------------------------------------------------

create table if not exists public.stock_movements (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  stock_item_id uuid not null,
  kind          text not null check (kind in ('in', 'out', 'adjust')),
  qty           numeric(12,3) not null,
  balance_after numeric(12,3) not null,
  reason        text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint stock_movements_qty_sign check (
    (kind in ('in', 'out') and qty > 0) or (kind = 'adjust' and qty <> 0)),
  constraint stock_movements_stock_item_fkey foreign key (restaurant_id, stock_item_id)
    references public.stock_items (restaurant_id, id) on delete cascade
);

create index if not exists stock_movements_item_idx
  on public.stock_movements (restaurant_id, stock_item_id, created_at desc);

select mt.apply_tenant_policies('stock_movements', 'member', 'admin', null, null);

-- ---------------------------------------------------------------------------
-- Movement trigger
-- ---------------------------------------------------------------------------
-- Locks the stock_items row, applies the movement and writes balance_after.
-- The current_qty >= 0 check refuses an out larger than the stock. Definer,
-- because app_service holds no update grant on current_qty; the function
-- checks that the item belongs to the movement's restaurant, so the definer
-- rights never cross a tenant.

create or replace function mt.stock_movements_apply()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_owner uuid;
  v_delta numeric(12,3);
  v_balance numeric(12,3);
begin
  select s.restaurant_id into v_owner from public.stock_items s where s.id = new.stock_item_id for update;
  if v_owner is null or v_owner <> new.restaurant_id then
    raise exception 'stock item % does not belong to restaurant %', new.stock_item_id, new.restaurant_id
      using errcode = '23503', constraint = 'stock_movements_item_restaurant';
  end if;

  v_delta := case new.kind when 'out' then -new.qty else new.qty end;
  update public.stock_items s
     set current_qty = s.current_qty + v_delta
   where s.id = new.stock_item_id
  returning s.current_qty into v_balance;

  new.balance_after := v_balance;
  return new;
end
$fn$;

revoke all on function mt.stock_movements_apply() from public;

create trigger stock_movements_apply
  before insert on public.stock_movements
  for each row execute function mt.stock_movements_apply();
