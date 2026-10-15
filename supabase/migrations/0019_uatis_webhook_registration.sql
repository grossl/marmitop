-- 0019_uatis_webhook_registration.sql
--
-- Register and use backend-uatis webhooks, by push or by the event feed (ADR-021, ADR-023;
-- 05.data-model.md "integrations_whatsapp", "uatis_event_receipts", "pg_cron schedules";
-- FR-170..FR-179).
--
--   * integrations_whatsapp.uatis_webhook_id      the registered backend-uatis webhook (FR-170)
--   * integrations_whatsapp.uatis_webhook_mode    push | pull, null exactly when no webhook (ADR-023)
--   * integrations_whatsapp.uatis_organization_id the API key's organization (FR-175)
--   * integrations_whatsapp.uatis_feed_cursor     last committed event-feed cursor (FR-174)
--   * integrations_whatsapp.last_webhook_at       last accepted push request (FR-176)
--   * integrations_whatsapp.last_polled_at        last timestamp poll (GET /v1/messages) (FR-174)
--   * integrations_whatsapp.webhook_secret_id     nullable: "Ativar webhook" stores it (push) or a
--                                                  pull webhook needs none (FR-085)
--   * uatis_event_receipts                        event ids already applied, push or pull (FR-176)
--   * mt.enqueue_whatsapp_sync                    skips push webhooks; pull webhooks keep a 10-minute
--                                                  timestamp poll as a safety net (ADR-023 known risk)
--   * mt.enqueue_uatis_feed_pulls(pull_seconds)   called by the worker timer (FR-174)
--   * mt.trim_uatis_event_receipts                daily, keeps 8 days

alter table public.integrations_whatsapp
  add column if not exists uatis_webhook_id uuid,
  add column if not exists uatis_webhook_mode text,
  add column if not exists uatis_organization_id uuid,
  add column if not exists uatis_feed_cursor text,
  add column if not exists last_webhook_at timestamptz,
  add column if not exists last_polled_at timestamptz;

alter table public.integrations_whatsapp
  alter column webhook_secret_id drop not null;

alter table public.integrations_whatsapp
  drop constraint if exists integrations_whatsapp_webhook_mode_check;
alter table public.integrations_whatsapp
  add constraint integrations_whatsapp_webhook_mode_check check (
    (uatis_webhook_id is null and uatis_webhook_mode is null)
    or (uatis_webhook_id is not null and uatis_webhook_mode is not null and uatis_webhook_mode in ('push', 'pull'))
  );

alter table public.integrations_whatsapp
  drop constraint if exists integrations_whatsapp_feed_cursor_length;
alter table public.integrations_whatsapp
  add constraint integrations_whatsapp_feed_cursor_length check (char_length(uatis_feed_cursor) <= 1024);

-- ---------------------------------------------------------------------------
-- uatis_event_receipts
-- ---------------------------------------------------------------------------

create table if not exists public.uatis_event_receipts (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  event_id      uuid not null,
  event_type    text not null check (char_length(event_type) <= 64),
  source        text not null check (source in ('push', 'pull')),
  received_at   timestamptz not null default now(),
  primary key (restaurant_id, event_id)
);

create index if not exists uatis_event_receipts_received_idx on public.uatis_event_receipts (received_at);

-- Read and insert: admin (the `system` actor of the route and the worker passes as admin).
-- No update. Delete: admin; the daily trim runs as definer.
select mt.apply_tenant_policies('uatis_event_receipts', 'admin', 'admin', null, 'admin');

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------

-- The 30-second timestamp poll (0012) now covers restaurants without a registered webhook. A
-- restaurant with one reads the event feed (ADR-023). In pull mode the timestamp poll still runs
-- every 10 minutes: a backend-uatis transaction that commits more than 2 seconds late can land
-- behind the feed cursor, and in push mode the push itself covers that case.
create or replace function mt.enqueue_whatsapp_sync()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select w.restaurant_id
    from public.integrations_whatsapp w
    where w.status = 'connected'
      and (
        w.uatis_webhook_id is null
        or (
          w.uatis_webhook_mode = 'pull'
          and (w.last_polled_at is null or w.last_polled_at <= pg_catalog.now() - interval '10 minutes')
        )
      )
      and not exists (
        select 1 from pgmq.q_mt_sync q
        where q.message ->> 'restaurantId' = w.restaurant_id::text
          and q.message ->> 'op' = 'whatsapp_reconcile'
      )
  loop
    perform pgmq.send('mt_sync', pg_catalog.jsonb_build_object(
      'v', 1, 'restaurantId', v_row.restaurant_id, 'op', 'whatsapp_reconcile'));
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$fn$;

-- One `uatis_feed_pull` job per connected restaurant with a registered webhook whose last read
-- is older than `p_pull_seconds` (pull mode) or 5 minutes (push mode), unless one is already
-- waiting. The worker calls it on a timer of `MT_UATIS_PULL_SECONDS` (pg_cron cannot read the
-- worker's environment), so it is granted to app_service. It only enqueues.
create or replace function mt.enqueue_uatis_feed_pulls(p_pull_seconds integer)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_row record;
  v_count integer := 0;
  v_pull interval := pg_catalog.make_interval(secs => greatest(1, least(coalesce(p_pull_seconds, 3), 60)));
begin
  for v_row in
    select w.restaurant_id
    from public.integrations_whatsapp w
    where w.status = 'connected'
      and w.uatis_webhook_id is not null
      and (
        w.last_synced_at is null
        or w.last_synced_at <= pg_catalog.now()
           - case w.uatis_webhook_mode when 'pull' then v_pull else interval '5 minutes' end
      )
      and not exists (
        select 1 from pgmq.q_mt_sync q
        where q.message ->> 'restaurantId' = w.restaurant_id::text
          and q.message ->> 'op' = 'uatis_feed_pull'
      )
  loop
    perform pgmq.send('mt_sync', pg_catalog.jsonb_build_object(
      'v', 1, 'restaurantId', v_row.restaurant_id, 'op', 'uatis_feed_pull'));
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$fn$;

create or replace function mt.trim_uatis_event_receipts()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_count integer;
begin
  delete from public.uatis_event_receipts where received_at < pg_catalog.now() - interval '8 days';
  get diagnostics v_count = row_count;
  return v_count;
end
$fn$;

revoke all on function mt.enqueue_whatsapp_sync() from public;
revoke all on function mt.enqueue_uatis_feed_pulls(integer) from public;
revoke all on function mt.trim_uatis_event_receipts() from public;
grant execute on function mt.enqueue_uatis_feed_pulls(integer) to app_service;

do $do$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'cron') then
    raise notice 'pg_cron not installed: skipping job schedules (expected on the integration-test database)';
    return;
  end if;
  perform cron.schedule('mt_trim_uatis_event_receipts', '55 3 * * *', 'select mt.trim_uatis_event_receipts()');
exception
  when insufficient_privilege then
    raise warning 'could not schedule pg_cron jobs (%): schedule them by hand per 11.operations.md', sqlerrm;
end
$do$;
