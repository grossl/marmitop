-- 0021_order_status_messages.sql
--
-- Order status messages on WhatsApp (ADR-026, FR-200–205; 05.data-model.md
-- "automatic_messages"). Six automatic message kinds, one per target status.
-- Forward-only (NFR-062).
--
-- Constraint names checked with pg_constraint against mt_test and the local
-- dev database: both are auto-generated from migrations 0003 and 0005.

alter table public.automatic_messages drop constraint automatic_messages_kind_check;
alter table public.automatic_messages add constraint automatic_messages_kind_check
  check (kind in (
    'welcome', 'closed', 'order_received',
    'order_confirmed', 'order_preparing', 'order_ready',
    'order_out_for_delivery', 'order_delivered', 'order_cancelled'
  ));

alter table public.messages drop constraint messages_automatic_kind_check;
alter table public.messages add constraint messages_automatic_kind_check
  check (automatic_kind in (
    'welcome', 'closed', 'order_received',
    'order_confirmed', 'order_preparing', 'order_ready',
    'order_out_for_delivery', 'order_delivered', 'order_cancelled'
  ));

-- FR-203: the "once per order per kind" lookup reads (restaurant_id, order_id, automatic_kind).
create index if not exists messages_restaurant_order_kind_idx
  on public.messages (restaurant_id, order_id, automatic_kind)
  where order_id is not null and automatic_kind is not null;

-- Default rows for every restaurant that exists now (ADR-026 texts and on/off).
insert into public.automatic_messages (restaurant_id, kind, enabled, body)
select r.id, d.kind, d.enabled, d.body
from public.restaurants r
cross join (values
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
