-- 0030_print_jobs.sql
--
-- Order tickets for the local thermal printer (ADR-038, FR-250–252;
-- 05.data-model.md "print_jobs"). Forward-only (NFR-062).
--
-- The print agent claims jobs through the public API with a 2-minute lease.
-- One order_ticket job per order. Rows are never deleted in v1.

alter table public.restaurant_settings
  add column if not exists auto_print_orders boolean not null default false;

create table if not exists public.print_jobs (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id      uuid not null,
  kind          text not null default 'order_ticket' check (kind in ('order_ticket')),
  status        text not null default 'pending' check (status in ('pending', 'printing', 'printed', 'failed')),
  attempts      int not null default 0 check (attempts >= 0),
  last_error    text check (char_length(last_error) <= 500),
  created_at    timestamptz not null default now(),
  claimed_at    timestamptz,
  printed_at    timestamptz,
  constraint print_jobs_order_kind_key unique (restaurant_id, order_id, kind),
  constraint print_jobs_order_fkey foreign key (restaurant_id, order_id)
    references public.orders (restaurant_id, id)
);

create index if not exists print_jobs_restaurant_status_idx
  on public.print_jobs (restaurant_id, status, created_at);

select mt.apply_tenant_policies('print_jobs', 'member', 'attendant', 'attendant', null);
