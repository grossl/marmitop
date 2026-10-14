-- 0011_audit_usage_job_attempts.sql
--
-- audit_logs, usage_events, job_attempts, idempotency_records, rate_counters
-- (05.data-model.md, 07.security.md "Audit logs", ADR-007, ADR-008).

create table if not exists public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  actor_type    text not null check (actor_type in ('user', 'api_key', 'system')),
  actor_id      uuid,
  action        text not null,
  entity_type   text not null,
  entity_id     uuid,
  context       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists audit_logs_restaurant_created_idx on public.audit_logs (restaurant_id, created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs (restaurant_id, entity_type, entity_id, created_at desc);

-- Append-only. Attendant actions produce audit rows, so attendants insert.
select mt.apply_tenant_policies('audit_logs', 'admin', 'attendant', null, null);

-- ---------------------------------------------------------------------------

create table if not exists public.usage_events (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  kind          text not null check (kind in ('order.created', 'message.sent', 'invoice.issued')),
  ref_id        uuid not null,
  occurred_at   timestamptz not null default now(),
  -- A retried job does not count twice.
  constraint usage_events_kind_ref_key unique (kind, ref_id)
);

create index if not exists usage_events_restaurant_kind_idx on public.usage_events (restaurant_id, kind, occurred_at);

select mt.apply_tenant_policies('usage_events', 'admin', 'attendant', null, null);

-- ---------------------------------------------------------------------------

create table if not exists public.job_attempts (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  queue         text not null check (queue in ('mt_outbound_messages', 'mt_webhook_deliveries', 'mt_invoice_jobs', 'mt_sync')),
  msg_id        bigint,
  subject_type  text not null check (subject_type in ('message', 'webhook_delivery', 'order_invoice', 'sync')),
  subject_id    uuid,
  attempt_no    integer not null check (attempt_no >= 1),
  outcome       text not null check (outcome in ('ok', 'transient_error', 'permanent_error')),
  http_status   integer,
  error_code    text,
  duration_ms   integer check (duration_ms >= 0),
  created_at    timestamptz not null default now()
);

create index if not exists job_attempts_subject_idx
  on public.job_attempts (restaurant_id, subject_type, subject_id, created_at desc);

select mt.apply_tenant_policies('job_attempts', 'admin', 'admin', null, null);

-- ---------------------------------------------------------------------------

create table if not exists public.idempotency_records (
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  request_hash    text not null,
  response_status integer not null,
  response_body   jsonb not null,
  created_at      timestamptz not null default now(),
  primary key (restaurant_id, idempotency_key)
);

select mt.apply_tenant_policies('idempotency_records', 'member', 'attendant', 'attendant', 'attendant');

-- ---------------------------------------------------------------------------
-- rate_counters: not a tenant table. The counter runs before the restaurant
-- context exists. Unlogged: a lost row costs one generous minute, never data.
-- ---------------------------------------------------------------------------

create unlogged table if not exists public.rate_counters (
  subject_id   uuid not null,
  class        text not null check (class in ('read', 'write', 'webhook')),
  window_start timestamptz not null,
  count        integer not null check (count >= 0),
  primary key (subject_id, class, window_start)
);

alter table public.rate_counters enable row level security;
alter table public.rate_counters force row level security;
revoke all on table public.rate_counters from public;
do $do$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on table public.rate_counters from %I', v_role);
    end if;
  end loop;
end
$do$;
grant select, insert, update, delete on table public.rate_counters to app_service;
create policy rate_counters_service_all on public.rate_counters for all to app_service
  using (true) with check (true);
