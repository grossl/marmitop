-- 0017_realtime_order_invoices.sql
--
-- The orders board shows an invoice badge per card (FR-139) and refreshes it live, so
-- order_invoices joins the supabase_realtime publication (05.data-model.md "Realtime
-- publication", ADR-004, ADR-017 Amendment 1).
--
-- Realtime checks each change against the `authenticated` select policy, so a member receives
-- events only for their own restaurants. The grant is column-level: the browser may read the
-- status columns, never `request_payload` (customer CPF/CNPJ and address), the error text, or
-- the cancel reason. Realtime leaves out the columns the role cannot select. `authenticated`
-- still gets no write grant (ADR-017).
--
-- The publication step is skipped when the publication does not exist (the integration-test
-- database), as in 0013.

grant select (id, restaurant_id, order_id, kind, status, created_at, updated_at)
  on table public.order_invoices to authenticated;

drop policy if exists order_invoices_user_select on public.order_invoices;
create policy order_invoices_user_select on public.order_invoices for select to authenticated
  using (restaurant_id in (select mt.user_restaurant_ids()));

do $do$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'publication supabase_realtime not found: skipping (expected on the integration-test database)';
    return;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_invoices'
  ) then
    alter publication supabase_realtime add table public.order_invoices;
  end if;
exception
  when insufficient_privilege then
    raise warning 'could not alter publication supabase_realtime (%): add order_invoices by hand', sqlerrm;
end
$do$;
