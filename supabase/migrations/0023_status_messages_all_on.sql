-- 0023_status_messages_all_on.sql
--
-- Every order status message is on by default (ADR-027, ADR-026
-- Amendment 2, FR-200). Forward-only (NFR-062).
--
-- 1. mt.insert_default_automatic_messages gives new restaurants
--    order_preparing and order_delivered turned on.
-- 2. Existing order_preparing and order_delivered rows that are off and
--    still hold the default text are turned on. A row with an edited text
--    keeps its switch, because an admin chose it.

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
    ('order_preparing', true,
     'Seu pedido {{pedido}} está sendo preparado.'),
    ('order_ready', true,
     'Seu pedido {{pedido}} está pronto! Pode vir retirar no {{restaurante}}.'),
    ('order_out_for_delivery', true,
     'Seu pedido {{pedido}} saiu para entrega!'),
    ('order_delivered', true,
     'Pedido {{pedido}} entregue. Obrigado pela preferência, {{nome}}!'),
    ('order_cancelled', true,
     'Seu pedido {{pedido}} foi cancelado. Se tiver dúvidas, responda esta mensagem.')
  ) as d(kind, enabled, body)
  on conflict (restaurant_id, kind) do nothing;
end
$fn$;

revoke all on function mt.insert_default_automatic_messages(uuid) from public;

update public.automatic_messages
set enabled = true
where enabled = false
  and (
    (kind = 'order_preparing' and body = 'Seu pedido {{pedido}} está sendo preparado.')
    or (kind = 'order_delivered' and body = 'Pedido {{pedido}} entregue. Obrigado pela preferência, {{nome}}!')
  );
