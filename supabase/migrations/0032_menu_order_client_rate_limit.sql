-- 0032_menu_order_client_rate_limit.sql
--
-- Per-visitor limit on public menu checkouts (FR-235, 07.security.md).
-- Forward-only (NFR-062).
--
-- rate_counters.class accepts 'menu_order_client'. Its subject_id is a hash of
-- the visitor's IP address and the restaurant id, never the address itself.

alter table public.rate_counters drop constraint if exists rate_counters_class_check;
alter table public.rate_counters add constraint rate_counters_class_check
  check (class in ('read', 'write', 'webhook', 'menu_order', 'menu_order_client'));
