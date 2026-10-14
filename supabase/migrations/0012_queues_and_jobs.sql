-- 0012_queues_and_jobs.sql
--
-- The four pgmq queues, their grants, and the security definer functions
-- pg_cron drives (05.data-model.md "Queues (pgmq)", "pg_cron schedules";
-- ADR-007, ADR-015, ADR-017).
--
-- The functions are plain SQL and plpgsql, so the integration tests call them
-- directly. Only the schedules need pg_cron, which the test database lacks;
-- that block skips with a notice.

-- ---------------------------------------------------------------------------
-- Queues
-- ---------------------------------------------------------------------------
-- mt_outbound_messages  { v, restaurantId, messageId }
-- mt_webhook_deliveries { v, restaurantId, deliveryId }
-- mt_invoice_jobs       { v, restaurantId, orderInvoiceId, op: issue | poll | cancel }
-- mt_sync               { v, restaurantId, op: 'whatsapp_reconcile' }

do $do$
declare
  v_queue text;
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'pgmq') then
    raise exception 'pgmq is not installed: create the extension (0000) before 0012';
  end if;

  foreach v_queue in array array['mt_outbound_messages', 'mt_webhook_deliveries', 'mt_invoice_jobs', 'mt_sync'] loop
    if not exists (select 1 from pgmq.meta where queue_name = v_queue) then
      perform pgmq.create(v_queue);
    end if;
  end loop;
end
$do$;

-- pgmq functions run as the caller, so app_service needs rights on the queue
-- and archive tables. authenticated and anon get nothing: queues are not a
-- tenant surface.
grant usage on schema pgmq to app_service;
grant select, insert, update, delete on
  pgmq.q_mt_outbound_messages, pgmq.a_mt_outbound_messages,
  pgmq.q_mt_webhook_deliveries, pgmq.a_mt_webhook_deliveries,
  pgmq.q_mt_invoice_jobs, pgmq.a_mt_invoice_jobs,
  pgmq.q_mt_sync, pgmq.a_mt_sync
  to app_service;
grant usage, select on all sequences in schema pgmq to app_service;
grant execute on all functions in schema pgmq to app_service;

-- ---------------------------------------------------------------------------
-- Scheduled functions. Each loops over restaurants itself, so pg_cron never
-- needs a restaurant context. Security definer, revoked from public.
-- ---------------------------------------------------------------------------

-- One mt_sync message per connected WhatsApp integration, unless one is
-- already waiting (visible or in flight).
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

-- One poll job per invoice still in flight at web-nf for over a minute,
-- unless a poll for it is already queued.
create or replace function mt.enqueue_invoice_polls()
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
    select i.id, i.restaurant_id
    from public.order_invoices i
    where i.status in ('queued', 'received', 'processing')
      and i.updated_at < pg_catalog.now() - interval '1 minute'
      and not exists (
        select 1 from pgmq.q_mt_invoice_jobs q
        where q.message ->> 'orderInvoiceId' = i.id::text
          and q.message ->> 'op' = 'poll'
      )
  loop
    perform pgmq.send('mt_invoice_jobs', pg_catalog.jsonb_build_object(
      'v', 1, 'restaurantId', v_row.restaurant_id, 'orderInvoiceId', v_row.id, 'op', 'poll'));
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$fn$;

-- Re-enqueue deliveries that are due. Recovers a job lost between commit and
-- send. A delivery with a message already queued is skipped.
create or replace function mt.requeue_due_deliveries()
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
    select d.id, d.restaurant_id
    from public.webhook_deliveries d
    where d.status in ('pending', 'failed')
      and d.next_attempt_at <= pg_catalog.now()
      and not exists (
        select 1 from pgmq.q_mt_webhook_deliveries q
        where q.message ->> 'deliveryId' = d.id::text
      )
  loop
    perform pgmq.send('mt_webhook_deliveries', pg_catalog.jsonb_build_object(
      'v', 1, 'restaurantId', v_row.restaurant_id, 'deliveryId', v_row.id));
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$fn$;

-- Outbound messages stuck in `pending` for 10 minutes become `failed` with
-- error_code `stuck`. Never resent automatically (07.security.md).
create or replace function mt.reap_stuck_messages()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_count integer;
begin
  update public.messages m
     set status = 'failed', error_code = 'stuck'
   where m.direction = 'out'
     and m.status = 'pending'
     and m.created_at < pg_catalog.now() - interval '10 minutes';
  get diagnostics v_count = row_count;
  return v_count;
end
$fn$;

create or replace function mt.trim_job_attempts()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_count integer;
begin
  delete from public.job_attempts where created_at < pg_catalog.now() - interval '30 days';
  get diagnostics v_count = row_count;
  return v_count;
end
$fn$;

create or replace function mt.trim_webhook_deliveries()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_count integer;
begin
  delete from public.webhook_deliveries
   where status in ('delivered', 'exhausted')
     and created_at < pg_catalog.now() - interval '30 days';
  get diagnostics v_count = row_count;
  return v_count;
end
$fn$;

create or replace function mt.trim_queue_archives()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_queue text;
  v_count integer;
  v_total integer := 0;
begin
  foreach v_queue in array array['mt_outbound_messages', 'mt_webhook_deliveries', 'mt_invoice_jobs', 'mt_sync'] loop
    execute format('delete from pgmq.%I where archived_at < pg_catalog.now() - interval ''14 days''', 'a_' || v_queue);
    get diagnostics v_count = row_count;
    v_total := v_total + v_count;
  end loop;
  return v_total;
end
$fn$;

create or replace function mt.trim_idempotency()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_count integer;
begin
  delete from public.idempotency_records where created_at < pg_catalog.now() - interval '30 days';
  get diagnostics v_count = row_count;
  return v_count;
end
$fn$;

create or replace function mt.trim_rate_counters()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_count integer;
begin
  delete from public.rate_counters where window_start < pg_catalog.now() - interval '1 hour';
  get diagnostics v_count = row_count;
  return v_count;
end
$fn$;

create or replace function mt.trim_audit_logs()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_count integer;
begin
  delete from public.audit_logs where created_at < pg_catalog.now() - interval '365 days';
  get diagnostics v_count = row_count;
  return v_count;
end
$fn$;

revoke all on function mt.enqueue_whatsapp_sync() from public;
revoke all on function mt.enqueue_invoice_polls() from public;
revoke all on function mt.requeue_due_deliveries() from public;
revoke all on function mt.reap_stuck_messages() from public;
revoke all on function mt.trim_job_attempts() from public;
revoke all on function mt.trim_webhook_deliveries() from public;
revoke all on function mt.trim_queue_archives() from public;
revoke all on function mt.trim_idempotency() from public;
revoke all on function mt.trim_rate_counters() from public;
revoke all on function mt.trim_audit_logs() from public;

-- ---------------------------------------------------------------------------
-- Schedules. cron.schedule upserts by job name, so a re-run is safe.
-- ---------------------------------------------------------------------------

do $do$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'cron') then
    raise notice 'pg_cron not installed: skipping job schedules (expected on the integration-test database)';
    return;
  end if;

  perform cron.schedule('mt_whatsapp_reconcile', '30 seconds', 'select mt.enqueue_whatsapp_sync()');
  perform cron.schedule('mt_invoice_poll', '* * * * *', 'select mt.enqueue_invoice_polls()');
  perform cron.schedule('mt_webhook_sweep', '* * * * *', 'select mt.requeue_due_deliveries()');
  perform cron.schedule('mt_reap_stuck_messages', '*/5 * * * *', 'select mt.reap_stuck_messages()');
  perform cron.schedule('mt_trim_job_attempts', '0 3 * * *', 'select mt.trim_job_attempts()');
  perform cron.schedule('mt_trim_deliveries', '15 3 * * *', 'select mt.trim_webhook_deliveries()');
  perform cron.schedule('mt_trim_queue_archives', '30 3 * * *', 'select mt.trim_queue_archives()');
  perform cron.schedule('mt_trim_idempotency', '50 3 * * *', 'select mt.trim_idempotency()');
  perform cron.schedule('mt_trim_rate_counters', '5 * * * *', 'select mt.trim_rate_counters()');
  perform cron.schedule('mt_trim_audit_logs', '45 3 * * *', 'select mt.trim_audit_logs()');
exception
  when insufficient_privilege then
    raise warning 'could not schedule pg_cron jobs (%): schedule them by hand per 11.operations.md', sqlerrm;
end
$do$;
