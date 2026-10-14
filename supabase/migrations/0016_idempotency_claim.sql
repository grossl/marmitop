-- 0016_idempotency_claim.sql
--
-- Idempotency-Key claims (06.api-spec.md "Idempotency", 05.data-model.md
-- "idempotency_records"; FR-145).
--
-- The public API claims a key before it runs the request: it inserts a row with
-- status 'in_progress' in its own short transaction. A second request with the
-- same key finds the claim and gets 409 idempotency_in_progress (same body) or
-- 409 idempotency_conflict (other body). On a 2xx the row stores the response
-- and becomes 'completed'. On any other outcome the claim is deleted, so the
-- client can retry. A claim older than 60 seconds may be taken over: its
-- request died.
--
-- * status: 'in_progress' | 'completed'. Existing rows are completed.
-- * response_status, response_body: null while in progress; set when completed.

alter table public.idempotency_records
  add column if not exists status text not null default 'completed';

alter table public.idempotency_records drop constraint if exists idempotency_records_status_check;
alter table public.idempotency_records add constraint idempotency_records_status_check
  check (status in ('in_progress', 'completed'));

alter table public.idempotency_records alter column response_status drop not null;
alter table public.idempotency_records alter column response_body drop not null;

alter table public.idempotency_records drop constraint if exists idempotency_records_completed_response;
alter table public.idempotency_records add constraint idempotency_records_completed_response
  check (status = 'in_progress' or (response_status is not null and response_body is not null));
