-- 0007_orders.sql
--
-- order_counters, orders, order_items, order_status_history,
-- mt.next_order_code, and the transition and subtotal triggers
-- (05.data-model.md "orders", "Order code", "Order status transitions";
-- ADR-006, ADR-017). FR-020–039.

-- ---------------------------------------------------------------------------
-- order_counters
-- ---------------------------------------------------------------------------
-- No grant on any path. mt.next_order_code is the only writer.

create table if not exists public.order_counters (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  last_value    bigint not null default 0 check (last_value >= 0)
);

select mt.apply_tenant_policies('order_counters', null, null, null, null);

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------

create table if not exists public.orders (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references public.restaurants(id) on delete cascade,
  code               text not null check (code ~ '^ORD-[0-9]{3,}$'),
  customer_id        uuid not null references public.customers(id) on delete restrict,
  status             text not null check (status in (
                       'aguardando', 'confirmado', 'preparando', 'pronto', 'saiu', 'entregue', 'cancelado')),
  fulfillment        text not null check (fulfillment in ('delivery', 'pickup')),
  cep                text check (cep ~ '^[0-9]{8}$'),
  logradouro         text,
  numero             text,
  complemento        text,
  bairro             text,
  cidade             text,
  uf                 text check (uf ~ '^[A-Z]{2}$'),
  codigo_municipio   text check (codigo_municipio ~ '^[0-9]{7}$'),
  payment_method     text not null check (payment_method in ('pix', 'dinheiro', 'cartao_credito', 'cartao_debito')),
  change_for_cents   bigint,
  notes              text check (char_length(notes) <= 1000),
  subtotal_cents     bigint not null check (subtotal_cents >= 0),
  delivery_fee_cents bigint not null default 0 check (delivery_fee_cents >= 0),
  total_cents        bigint not null,
  source             text not null,
  conversation_id    uuid references public.conversations(id) on delete set null,
  created_by         uuid references auth.users(id) on delete set null,
  created_by_api_key uuid references public.api_keys(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  delivered_at       timestamptz,
  cancelled_at       timestamptz,
  cancel_reason      text,
  constraint orders_restaurant_code_key unique (restaurant_id, code),
  constraint orders_total_is_sum check (total_cents = subtotal_cents + delivery_fee_cents),
  constraint orders_fee_delivery_only check (fulfillment = 'delivery' or delivery_fee_cents = 0),
  constraint orders_delivery_address check (fulfillment = 'pickup' or (logradouro is not null and bairro is not null)),
  constraint orders_change_for check (
    change_for_cents is null or (payment_method = 'dinheiro' and change_for_cents >= total_cents)),
  constraint orders_saiu_delivery_only check (status <> 'saiu' or fulfillment = 'delivery'),
  constraint orders_source check (source in ('counter', 'phone', 'whatsapp', 'api'))
);

create index if not exists orders_board_idx on public.orders (restaurant_id, status, created_at desc);
create index if not exists orders_restaurant_created_idx on public.orders (restaurant_id, created_at desc);
create index if not exists orders_customer_history_idx on public.orders (restaurant_id, customer_id, created_at desc);
create index if not exists orders_code_trgm_idx on public.orders using gin (code extensions.gin_trgm_ops);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function mt.set_updated_at();

select mt.apply_tenant_policies('orders', 'member', 'attendant', 'attendant', 'attendant');

grant select on table public.orders to authenticated;
create policy orders_user_select on public.orders for select to authenticated
  using (restaurant_id in (select mt.user_restaurant_ids()));

-- The `Pedido #ORD-001` tag on a message (0005 left the column without a key).
alter table public.messages
  add constraint messages_order_id_fkey foreign key (order_id) references public.orders(id) on delete set null;

-- ---------------------------------------------------------------------------
-- order_items
-- ---------------------------------------------------------------------------

create table if not exists public.order_items (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants(id) on delete cascade,
  order_id         uuid not null references public.orders(id) on delete cascade,
  menu_item_id     uuid references public.menu_items(id) on delete set null,
  name             text not null,
  size_name        text,
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  qty              integer not null check (qty between 1 and 99),
  line_total_cents bigint generated always as (unit_price_cents * qty) stored,
  notes            text check (char_length(notes) <= 280),
  position         smallint not null default 0
);

create index if not exists order_items_restaurant_order_idx on public.order_items (restaurant_id, order_id);
create index if not exists order_items_restaurant_menu_item_idx on public.order_items (restaurant_id, menu_item_id);

select mt.apply_tenant_policies('order_items', 'member', 'attendant', 'attendant', 'attendant');

-- ---------------------------------------------------------------------------
-- order_status_history (append-only)
-- ---------------------------------------------------------------------------

create table if not exists public.order_status_history (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id      uuid not null references public.orders(id) on delete cascade,
  from_status   text,
  to_status     text not null,
  changed_by    uuid references auth.users(id) on delete set null,
  actor_type    text not null check (actor_type in ('user', 'api_key', 'system')),
  changed_at    timestamptz not null default now()
);

create index if not exists order_status_history_order_idx
  on public.order_status_history (restaurant_id, order_id, changed_at);

select mt.apply_tenant_policies('order_status_history', 'member', 'attendant', null, null);

-- ---------------------------------------------------------------------------
-- Order code (05.data-model.md "Order code")
-- ---------------------------------------------------------------------------
-- The counter row lock serializes concurrent orders of one restaurant only.
-- Definer, because order_counters has no grant on any path; the function
-- applies the orders insert rule itself.

create or replace function mt.next_order_code(p_restaurant_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_value bigint;
begin
  if p_restaurant_id is distinct from mt.current_restaurant_id() or not mt.can_write('attendant') then
    raise exception 'mt.next_order_code: not allowed for restaurant %', p_restaurant_id using errcode = '42501';
  end if;

  insert into public.order_counters as c (restaurant_id, last_value) values (p_restaurant_id, 1)
  on conflict (restaurant_id) do update set last_value = c.last_value + 1
  returning c.last_value into v_value;

  -- lpad() truncates a longer string, so it only runs below three digits.
  return 'ORD-' || case when v_value < 100 then pg_catalog.lpad(v_value::text, 3, '0') else v_value::text end;
end
$fn$;

revoke all on function mt.next_order_code(uuid) from public;
grant execute on function mt.next_order_code(uuid) to app_service;

-- ---------------------------------------------------------------------------
-- Status transitions (05.data-model.md "Order status transitions", ADR-017)
-- ---------------------------------------------------------------------------
-- The same table as packages/core canTransition: forward moves may skip
-- columns, backward moves go one step, entregue and cancelado are final, any
-- non-final status may move to cancelado, and pickup orders never enter saiu.
-- The same status is not a move; the trigger treats it as a no-op.

create or replace function mt.order_transition_allowed(p_from text, p_to text, p_fulfillment text)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_seq text[];
  v_from integer;
  v_to integer;
begin
  if p_from is null or p_to is null or p_from = p_to or p_from in ('entregue', 'cancelado') then
    return false;
  end if;

  v_seq := case p_fulfillment
    when 'delivery' then array['aguardando', 'confirmado', 'preparando', 'pronto', 'saiu', 'entregue']
    when 'pickup' then array['aguardando', 'confirmado', 'preparando', 'pronto', 'entregue']
  end;
  v_from := pg_catalog.array_position(v_seq, p_from);
  if v_seq is null or v_from is null then
    return false;
  end if;
  if p_to = 'cancelado' then
    return true;
  end if;

  v_to := pg_catalog.array_position(v_seq, p_to);
  if v_to is null then
    return false;
  end if;
  return v_to > v_from or v_to = v_from - 1;
end
$fn$;

revoke all on function mt.order_transition_allowed(text, text, text) from public;
grant execute on function mt.order_transition_allowed(text, text, text) to app_service;

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
  elsif new.status = 'cancelado' then
    new.cancelled_at := pg_catalog.now();
  end if;

  insert into public.order_status_history (restaurant_id, order_id, from_status, to_status, changed_by, actor_type)
  values (new.restaurant_id, new.id, old.status, new.status, mt.current_user_id(),
          coalesce(mt.current_actor_type(), 'system'));
  return new;
end
$fn$;

create or replace function mt.orders_initial_history()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $fn$
begin
  insert into public.order_status_history
    (restaurant_id, order_id, from_status, to_status, changed_by, actor_type, changed_at)
  values (new.restaurant_id, new.id, null, new.status, mt.current_user_id(),
          coalesce(mt.current_actor_type(), 'system'), new.created_at);
  return null;
end
$fn$;

revoke all on function mt.orders_status_transition() from public;
revoke all on function mt.orders_initial_history() from public;

create trigger orders_status_transition
  before update of status on public.orders
  for each row execute function mt.orders_status_transition();

create trigger orders_initial_history
  after insert on public.orders
  for each row execute function mt.orders_initial_history();

-- ---------------------------------------------------------------------------
-- Subtotal (ADR-006)
-- ---------------------------------------------------------------------------
-- A check constraint cannot sum rows, so a deferred constraint trigger checks
-- `subtotal_cents = sum(order_items.line_total_cents)` at commit, after the
-- service has written the order and its items in one transaction. It fires on
-- the order (insert, subtotal change) and on its items (any change). Definer,
-- so the sum sees every item of the order regardless of the caller's policies.

create or replace function mt.check_order_subtotal(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_subtotal bigint;
  v_code text;
  v_sum bigint;
begin
  select o.subtotal_cents, o.code into v_subtotal, v_code from public.orders o where o.id = p_order_id;
  if not found then
    return;
  end if;
  select coalesce(sum(i.line_total_cents), 0) into v_sum from public.order_items i where i.order_id = p_order_id;
  if v_sum <> v_subtotal then
    raise exception 'order %: subtotal_cents % does not match the items (%)', v_code, v_subtotal, v_sum
      using errcode = '23514', constraint = 'orders_subtotal_matches_items';
  end if;
end
$fn$;

create or replace function mt.orders_subtotal_matches_items()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if tg_table_name = 'orders' then
    perform mt.check_order_subtotal(new.id);
  else
    if tg_op <> 'DELETE' then
      perform mt.check_order_subtotal(new.order_id);
    end if;
    if tg_op <> 'INSERT' and (tg_op = 'DELETE' or old.order_id <> new.order_id) then
      perform mt.check_order_subtotal(old.order_id);
    end if;
  end if;
  return null;
end
$fn$;

revoke all on function mt.check_order_subtotal(uuid) from public;
revoke all on function mt.orders_subtotal_matches_items() from public;
grant execute on function mt.check_order_subtotal(uuid) to app_service;

create constraint trigger orders_subtotal_matches_items
  after insert or update of subtotal_cents on public.orders
  deferrable initially deferred
  for each row execute function mt.orders_subtotal_matches_items();

create constraint trigger order_items_subtotal_matches_items
  after insert or update or delete on public.order_items
  deferrable initially deferred
  for each row execute function mt.orders_subtotal_matches_items();
