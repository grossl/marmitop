-- 0024_ai_auto_confirm_orders.sql
--
-- "Confirmar pedidos da IA automaticamente" (ADR-027 Amendment 1, FR-213;
-- 05.data-model.md "ai_settings"). Forward-only (NFR-062).
--
-- Off by default: an AI order waits as aguardando until a person confirms it.

alter table public.ai_settings
  add column if not exists auto_confirm_orders boolean not null default false;
