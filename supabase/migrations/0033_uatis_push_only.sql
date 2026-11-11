-- 0033_uatis_push_only.sql
--
-- Webhook only, with a manual refresh (ADR-042; FR-107, FR-170, FR-174; 05.data-model.md
-- "Manual refresh"). Forward-only (NFR-062).
--
--   * unschedule mt_whatsapp_reconcile        no schedule reads backend-uatis
--   * drop mt.enqueue_whatsapp_sync()         the 30-second timestamp poll
--   * drop mt.enqueue_uatis_feed_pulls(int)   the worker feed timer
--   * clear pull webhooks                     they show "Não registrado"; the admin registers push
--   * uatis_webhook_mode                      push only
--   * drop uatis_feed_cursor                  Marmitop no longer reads the event feed
--   * mt.request_whatsapp_refresh()           "Atualizar": one whatsapp_reconcile job for the
--                                             restaurant in the RLS context

do $do$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'cron') then
    raise notice 'pg_cron not installed: nothing to unschedule (expected on the integration-test database)';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'mt_whatsapp_reconcile') then
    perform cron.unschedule('mt_whatsapp_reconcile');
  end if;
exception
  when insufficient_privilege then
    raise warning 'could not unschedule mt_whatsapp_reconcile (%): unschedule it by hand per 11.operations.md', sqlerrm;
end
$do$;

drop function if exists mt.enqueue_whatsapp_sync();
drop function if exists mt.enqueue_uatis_feed_pulls(integer);

-- Jobs that the old schedules left in the queue would fail on an unknown op.
delete from pgmq.q_mt_sync where message ->> 'op' = 'uatis_feed_pull';

update public.integrations_whatsapp
set uatis_webhook_id = null, uatis_webhook_mode = null, uatis_organization_id = null
where uatis_webhook_mode = 'pull';

alter table public.integrations_whatsapp
  drop constraint if exists integrations_whatsapp_webhook_mode_check;
alter table public.integrations_whatsapp
  add constraint integrations_whatsapp_webhook_mode_check check (
    (uatis_webhook_id is null and uatis_webhook_mode is null)
    or (uatis_webhook_id is not null and uatis_webhook_mode = 'push')
  );

alter table public.integrations_whatsapp
  drop constraint if exists integrations_whatsapp_feed_cursor_length;
alter table public.integrations_whatsapp
  drop column if exists uatis_feed_cursor;

-- No restaurant parameter: the restaurant comes from the RLS context that the service set, so a
-- member can refresh only their own restaurant.
create or replace function mt.request_whatsapp_refresh()
returns text
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_restaurant uuid := mt.current_restaurant_id();
begin
  if v_restaurant is null then
    raise exception 'request_whatsapp_refresh needs a restaurant context' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.integrations_whatsapp w
    where w.restaurant_id = v_restaurant and w.status = 'connected'
  ) then
    return 'not_connected';
  end if;
  if exists (
    select 1 from pgmq.q_mt_sync q
    where q.message ->> 'restaurantId' = v_restaurant::text
      and q.message ->> 'op' = 'whatsapp_reconcile'
  ) then
    return 'already_queued';
  end if;
  perform pgmq.send('mt_sync', pg_catalog.jsonb_build_object(
    'v', 1, 'restaurantId', v_restaurant, 'op', 'whatsapp_reconcile'));
  return 'enqueued';
end
$fn$;

revoke all on function mt.request_whatsapp_refresh() from public;
grant execute on function mt.request_whatsapp_refresh() to app_service;
