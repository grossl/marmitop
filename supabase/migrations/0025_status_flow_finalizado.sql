-- 0025_status_flow_finalizado.sql
--
-- Status flow without `preparando`; `entregue` becomes `finalizado`
-- (ADR-028, amends ADR-017, ADR-026, ADR-027; FR-021–029, FR-200;
-- 05.data-model.md "orders", "Order status transitions",
-- "automatic_messages"). Forward-only (NFR-062).
--
-- Delivery: aguardando → confirmado → pronto → saiu → finalizado
-- Pickup:   aguardando → confirmado → pronto → finalizado
--
-- 1. orders: preparando → confirmado, entregue → finalizado. The rename is
--    not a move, so the transition and updated_at triggers are off for it.
-- 2. order_status_history: entregue → finalizado, preparando → confirmado,
--    then the rows that became confirmado → confirmado are deleted.
-- 3. The orders.status check, mt.order_transition_allowed, and the
--    transition trigger (latest body: 0018, with the paid_at rule) use the
--    new names. finalizado sets delivered_at and, when null, paid_at.
-- 4. automatic_messages: the order_preparing and order_delivered rows go,
--    the kind check keeps seven kinds, and the defaults lose both kinds.
--    messages.automatic_kind keeps both values: sent messages are a record.
--
-- Constraint names (orders_status_check, automatic_messages_kind_check)
-- are the auto-generated names from 0007 and 0021.

-- ---------------------------------------------------------------------------
-- 1. orders.status
-- ---------------------------------------------------------------------------

alter table public.orders drop constraint orders_status_check;

alter table public.orders disable trigger orders_status_transition;
alter table public.orders disable trigger orders_set_updated_at;

update public.orders set status = 'confirmado' where status = 'preparando';
update public.orders set status = 'finalizado' where status = 'entregue';

alter table public.orders enable trigger orders_status_transition;
alter table public.orders enable trigger orders_set_updated_at;

alter table public.orders add constraint orders_status_check
  check (status in ('aguardando', 'confirmado', 'pronto', 'saiu', 'finalizado', 'cancelado'));

-- ---------------------------------------------------------------------------
-- 2. order_status_history
-- ---------------------------------------------------------------------------

update public.order_status_history set from_status = 'finalizado' where from_status = 'entregue';
update public.order_status_history set to_status = 'finalizado' where to_status = 'entregue';
update public.order_status_history set from_status = 'confirmado' where from_status = 'preparando';
update public.order_status_history set to_status = 'confirmado' where to_status = 'preparando';
delete from public.order_status_history where from_status = to_status;

-- ---------------------------------------------------------------------------
-- 3. Status transitions (05.data-model.md "Order status transitions")
-- ---------------------------------------------------------------------------
-- The same table as packages/core canTransition: forward moves may skip
-- columns, backward moves go one step, finalizado and cancelado are final,
-- any non-final status may move to cancelado, and pickup orders never enter
-- saiu. The same status is not a move; the trigger treats it as a no-op.

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
  if p_from is null or p_to is null or p_from = p_to or p_from in ('finalizado', 'cancelado') then
    return false;
  end if;

  v_seq := case p_fulfillment
    when 'delivery' then array['aguardando', 'confirmado', 'pronto', 'saiu', 'finalizado']
    when 'pickup' then array['aguardando', 'confirmado', 'pronto', 'finalizado']
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

-- The transition trigger from 0018 with finalizado in place of entregue.
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

  if new.status = 'finalizado' then
    new.delivered_at := pg_catalog.now();
    -- FR-160: finalizado marks the order paid unless staff marked it earlier.
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

revoke all on function mt.orders_status_transition() from public;

-- ---------------------------------------------------------------------------
-- 4. automatic_messages
-- ---------------------------------------------------------------------------

delete from public.automatic_messages where kind in ('order_preparing', 'order_delivered');

alter table public.automatic_messages drop constraint automatic_messages_kind_check;
alter table public.automatic_messages add constraint automatic_messages_kind_check
  check (kind in (
    'welcome', 'closed', 'order_received',
    'order_confirmed', 'order_ready', 'order_out_for_delivery', 'order_cancelled'
  ));

create or replace function mt.insert_default_automatic_messages(p_restaurant_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $fn$
begin
  insert into public.automatic_messages (restaurant_id, kind, enabled, body)
  select p_restaurant_id, d.kind, d.enabled, d.body
  from (values
    ('welcome', true,
     'Olá! Aqui é {{restaurante}}. Como podemos ajudar?'),
    ('closed', true,
     'Olá! Estamos fora do nosso horário de atendimento. Retornaremos assim que abrirmos.'),
    ('order_received', true,
     'Recebemos seu pedido! Em breve confirmaremos os detalhes.'),
    ('order_confirmed', true,
     'Olá {{nome}}! Seu pedido {{pedido}} foi confirmado e logo entra em preparo.'),
    ('order_ready', true,
     'Seu pedido {{pedido}} está pronto! Pode vir retirar no {{restaurante}}.'),
    ('order_out_for_delivery', true,
     'Seu pedido {{pedido}} saiu para entrega!'),
    ('order_cancelled', true,
     'Seu pedido {{pedido}} foi cancelado. Se tiver dúvidas, responda esta mensagem.')
  ) as d(kind, enabled, body)
  on conflict (restaurant_id, kind) do nothing;
end
$fn$;

revoke all on function mt.insert_default_automatic_messages(uuid) from public;
