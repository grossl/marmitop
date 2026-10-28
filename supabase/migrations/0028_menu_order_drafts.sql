-- 0028_menu_order_drafts.sql
--
-- Menu order drafts (ADR-033, FR-232, FR-239, 05.data-model.md
-- "menu_order_drafts"). Forward-only (NFR-062).
--
-- The public menu checkout saves a draft with a random reference. The
-- customer's WhatsApp message carries the reference, and the inbound path
-- turns the draft into an order. Rows are never deleted in v1.

create table if not exists public.menu_order_drafts (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  reference     text not null check (reference ~ '^[A-Z2-9]{8}$'),
  payload       jsonb not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '24 hours',
  order_id      uuid,
  converted_at  timestamptz,
  constraint menu_order_drafts_reference_key unique (restaurant_id, reference),
  constraint menu_order_drafts_order_fkey foreign key (restaurant_id, order_id)
    references public.orders (restaurant_id, id) on delete set null (order_id)
);

select mt.apply_tenant_policies('menu_order_drafts', 'member', 'admin', 'admin', null);
