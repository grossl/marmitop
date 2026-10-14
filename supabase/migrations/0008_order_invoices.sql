-- 0008_order_invoices.sql
--
-- order_invoices and its guard trigger (05.data-model.md, ADR-003, ADR-015,
-- ADR-016). FR-120–139.

create table if not exists public.order_invoices (
  id                  uuid primary key default gen_random_uuid(),
  restaurant_id       uuid not null references public.restaurants(id) on delete cascade,
  order_id            uuid not null,
  kind                text not null check (kind in ('nfce', 'nfe')),
  status              text not null default 'queued' check (status in (
                        'queued', 'received', 'processing', 'authorized',
                        'rejected', 'denied', 'failed', 'cancelled')),
  external_id         text,
  numero              integer,
  serie               integer,
  chave_acesso        text check (chave_acesso ~ '^[0-9]{44}$'),
  error_code          text,
  error_message       text,
  request_payload     jsonb,
  created_by          uuid references auth.users(id) on delete set null,
  cancel_requested_at timestamptz,
  cancel_requested_by uuid references auth.users(id) on delete set null,
  cancel_reason       text check (char_length(cancel_reason) between 15 and 255),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint order_invoices_order_fkey foreign key (restaurant_id, order_id)
    references public.orders (restaurant_id, id) on delete restrict
);

create unique index if not exists order_invoices_restaurant_external_key
  on public.order_invoices (restaurant_id, external_id) where external_id is not null;
-- One live invoice per order. A rejected, denied, failed or cancelled invoice
-- frees the order for a new attempt.
create unique index if not exists order_invoices_one_live_per_order
  on public.order_invoices (order_id) where status in ('queued', 'received', 'processing', 'authorized');

create trigger order_invoices_set_updated_at
  before update on public.order_invoices
  for each row execute function mt.set_updated_at();

-- No delete grant: rows are never deleted in v1 (05.data-model.md "Role rules", ADR-018).
select mt.apply_tenant_policies('order_invoices', 'member', 'attendant', 'attendant', null);

-- ---------------------------------------------------------------------------
-- Guard (07.security.md "Triggers guard invariants")
-- ---------------------------------------------------------------------------
-- * Only an admin requests a cancellation (ADR-015). The worker runs as
--   `system`, which mt.actor_role() maps to admin. A change to any of the
--   three cancel_* columns counts as a request.
-- * request_payload is the exact first POST body. Retries resend it, because
--   web-nf binds the Idempotency-Key to the body (ADR-016). Set once.

create or replace function mt.order_invoices_cancel_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_cancel_changed boolean;
begin
  if tg_op = 'INSERT' then
    v_cancel_changed := new.cancel_requested_at is not null
      or new.cancel_requested_by is not null
      or new.cancel_reason is not null;
  else
    v_cancel_changed := new.cancel_requested_at is distinct from old.cancel_requested_at
      or new.cancel_requested_by is distinct from old.cancel_requested_by
      or new.cancel_reason is distinct from old.cancel_reason;
    if old.request_payload is not null and new.request_payload is distinct from old.request_payload then
      raise exception 'order_invoices %: request_payload is set once', old.id
        using errcode = '23514', constraint = 'order_invoices_request_payload_frozen';
    end if;
  end if;

  if v_cancel_changed and mt.actor_role() is distinct from 'admin' then
    raise exception 'only an admin may request an invoice cancellation'
      using errcode = '42501';
  end if;
  return new;
end
$fn$;

revoke all on function mt.order_invoices_cancel_guard() from public;

create trigger order_invoices_cancel_guard
  before insert or update on public.order_invoices
  for each row execute function mt.order_invoices_cancel_guard();
