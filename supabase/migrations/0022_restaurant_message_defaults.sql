-- 0022_restaurant_message_defaults.sql
--
-- Default automatic messages for new restaurants (ADR-026 Amendment 1,
-- FR-084, FR-200; 05.data-model.md "automatic_messages"). Forward-only
-- (NFR-062).
--
-- mt.insert_default_automatic_messages is the only place that holds the
-- default texts. mt.create_restaurant calls it, so a restaurant created by
-- onboarding gets all nine rows. Existing restaurants are not back-filled
-- here: 0021 already gave them the six status kinds, and a missing welcome,
-- closed, or order_received row means the restaurant never turned it on.

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
    ('order_preparing', false,
     'Seu pedido {{pedido}} está sendo preparado.'),
    ('order_ready', true,
     'Seu pedido {{pedido}} está pronto! Pode vir retirar no {{restaurante}}.'),
    ('order_out_for_delivery', true,
     'Seu pedido {{pedido}} saiu para entrega!'),
    ('order_delivered', false,
     'Pedido {{pedido}} entregue. Obrigado pela preferência, {{nome}}!'),
    ('order_cancelled', true,
     'Seu pedido {{pedido}} foi cancelado. Se tiver dúvidas, responda esta mensagem.')
  ) as d(kind, enabled, body)
  on conflict (restaurant_id, kind) do nothing;
end
$fn$;

-- Same signature, security definer, search_path, and grants as in 0002.
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
  perform mt.insert_default_automatic_messages(v_id);
  return v_id;
end
$fn$;

revoke all on function mt.insert_default_automatic_messages(uuid) from public;
revoke all on function mt.create_restaurant(text, uuid) from public;
grant execute on function mt.create_restaurant(text, uuid) to app_service;
