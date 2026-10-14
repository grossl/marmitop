-- 0018_orders_paid_at.sql
--
-- Payment mark on orders for the Finance page (ADR-020; 05.data-model.md "orders",
-- "Order status transitions"; FR-160..FR-169).
--
--   * orders.paid_at, orders.paid_by
--   * backfill paid_at = delivered_at for every `entregue` order
--   * partial index (restaurant_id, paid_at desc, id desc) for the Finance list (FR-164)
--   * the transition trigger sets paid_at on `entregue` when it is null (FR-160), so the
--     dashboard and the public API agree
--   * orders_paid_guard: only an admin clears a set paid_at (FR-162)

alter table public.orders
  add column if not exists paid_at timestamptz,
  add column if not exists paid_by uuid references auth.users(id) on delete set null;

update public.orders
set paid_at = delivered_at
where status = 'entregue' and paid_at is null and delivered_at is not null;

create index if not exists orders_restaurant_paid_idx
  on public.orders (restaurant_id, paid_at desc, id desc)
  where paid_at is not null;

-- The transition trigger from 0007, plus the paid_at rule. The rest is unchanged.
create or replace function mt.orders_status_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if new.status = old.status then
    return new;
  end if;

  if not mt.order_transition_allowed(old.status, new.status, new.fulfillment) then
    raise exception 'order %: status % cannot move to % (%)', old.code, old.status, new.status, new.fulfillment
      using errcode = '23514', constraint = 'orders_status_transition';
  end if;

  if new.status = 'entregue' then
    new.delivered_at := pg_catalog.now();
    -- FR-160: delivery marks the order paid unless staff marked it earlier.
    if new.paid_at is null then
      new.paid_at := pg_catalog.now();
      new.paid_by := mt.current_user_id();
    end if;
  elsif new.status = 'cancelado' then
    new.cancelled_at := pg_catalog.now();
  end if;

  insert into public.order_status_history (restaurant_id, order_id, from_status, to_status, changed_by, actor_type)
  values (new.restaurant_id, new.id, old.status, new.status, mt.current_user_id(),
          coalesce(mt.current_actor_type(), 'system'));
  return new;
end
$fn$;

-- FR-162: clearing the payment mark is admin only. The service checks the role first; this is
-- the backstop for any other write path. A connection with no service context (the migration
-- owner, the seed) passes.
create or replace function mt.orders_paid_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if old.paid_at is not null and new.paid_at is null
     and mt.current_restaurant_id() is not null
     and mt.actor_role() is distinct from 'admin' then
    raise exception 'order %: only an admin clears the payment mark', old.code
      using errcode = '42501';
  end if;
  if new.paid_at is null then
    new.paid_by := null;
  end if;
  return new;
end
$fn$;

revoke all on function mt.orders_paid_guard() from public;

drop trigger if exists orders_paid_guard on public.orders;
create trigger orders_paid_guard
  before update of paid_at on public.orders
  for each row execute function mt.orders_paid_guard();
