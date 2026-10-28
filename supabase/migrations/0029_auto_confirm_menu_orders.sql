-- 0029_auto_confirm_menu_orders.sql
--
-- "Confirmar pedidos do cardápio online automaticamente" (ADR-035, FR-240;
-- 05.data-model.md "restaurant_settings"). Forward-only (NFR-062).
--
-- Off by default: a menu order waits as aguardando until a person confirms it.

alter table public.restaurant_settings
  add column if not exists auto_confirm_menu_orders boolean not null default false;
