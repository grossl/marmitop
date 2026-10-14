-- 0010_webhooks.sql
--
-- webhook_endpoints, webhook_deliveries (05.data-model.md, ADR-009).
-- FR-146–149.

create table if not exists public.webhook_endpoints (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  url           text not null check (url ~ '^https?://'),
  secret_id     uuid not null references public.secrets(id) on delete restrict,
  enabled       boolean not null default true,
  events        text[] not null check (
                  events <@ array['order.created', 'order.status_changed', 'message.received', 'invoice.updated']::text[]),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- One endpoint per restaurant in v1 (ADR-009).
  constraint webhook_endpoints_restaurant_key unique (restaurant_id)
);

comment on column public.webhook_endpoints.url is '^https:// in production; the service enforces it with the SSRF guard (ADR-017).';

create trigger webhook_endpoints_set_updated_at
  before update on public.webhook_endpoints
  for each row execute function mt.set_updated_at();

create trigger webhook_endpoints_secret_kind
  before insert or update on public.webhook_endpoints
  for each row execute function mt.check_secret_refs('secret_id', 'outbound_webhook_secret');

-- Member-readable: producers run as attendants and API keys and must find the
-- endpoint. The row holds a secret id, never a secret value.
select mt.apply_tenant_policies('webhook_endpoints', 'member', 'admin', 'admin', 'admin');

-- ---------------------------------------------------------------------------

create table if not exists public.webhook_deliveries (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants(id) on delete cascade,
  endpoint_id      uuid not null references public.webhook_endpoints(id) on delete cascade,
  event            text not null,
  payload          jsonb not null,
  status           text not null default 'pending' check (status in ('pending', 'delivered', 'failed', 'exhausted')),
  attempts         integer not null default 0 check (attempts >= 0),
  last_status_code integer,
  last_error       text check (char_length(last_error) <= 200),
  next_attempt_at  timestamptz,
  delivered_at     timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists webhook_deliveries_restaurant_created_idx
  on public.webhook_deliveries (restaurant_id, created_at desc);
create index if not exists webhook_deliveries_due_idx
  on public.webhook_deliveries (next_attempt_at) where status in ('pending', 'failed');

-- Producers (attendants, API keys) insert; only admins and the worker read or
-- change a delivery.
select mt.apply_tenant_policies('webhook_deliveries', 'admin', 'attendant', 'admin', 'admin');
