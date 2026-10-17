-- 0020_ai_order_assistant.sql
--
-- AI order assistant (12.ai-order-assistant.md "Data model (migration 0020)",
-- 05.data-model.md "AI order assistant (migration 0020)", ADR-025,
-- FR-180–199). Tenant composite foreign keys per ADR-018. authenticated gets
-- no grant on the new tables (ADR-017); the worker writes them as the system
-- actor, which mt.actor_role() maps to 'admin'.

-- ---------------------------------------------------------------------------
-- Plans: AI reply quota and overage price (per 100 replies). Seed values; the
-- owner sets real ones (FR-194).
-- ---------------------------------------------------------------------------
alter table public.plans
  add column if not exists included_ai_replies_month integer not null default 0
    check (included_ai_replies_month >= 0),
  add column if not exists ai_overage_price_cents bigint not null default 0
    check (ai_overage_price_cents >= 0);
update public.plans set included_ai_replies_month = 300,  ai_overage_price_cents = 500 where code = 'free';
update public.plans set included_ai_replies_month = 3000, ai_overage_price_cents = 500 where code = 'pro';

-- ---------------------------------------------------------------------------
-- Usage meter: one ai.reply row per turn that calls the model (FR-196).
-- Constraint names checked against migration 0011 (auto-generated).
-- ---------------------------------------------------------------------------
alter table public.usage_events drop constraint usage_events_kind_check;
alter table public.usage_events add constraint usage_events_kind_check
  check (kind in ('order.created', 'message.sent', 'invoice.issued', 'ai.reply'));

-- Job attempts: the new queue and subject.
alter table public.job_attempts drop constraint job_attempts_queue_check;
alter table public.job_attempts add constraint job_attempts_queue_check
  check (queue in ('mt_outbound_messages', 'mt_webhook_deliveries', 'mt_invoice_jobs', 'mt_sync', 'mt_ai_turns'));
alter table public.job_attempts drop constraint job_attempts_subject_type_check;
alter table public.job_attempts add constraint job_attempts_subject_type_check
  check (subject_type in ('message', 'webhook_delivery', 'order_invoice', 'sync', 'ai_turn'));

-- Orders from the assistant start with no payment method: null = "A definir"
-- (FR-188). orders_payment_method_check and orders_change_for both pass on null.
alter table public.orders alter column payment_method drop not null;

-- ---------------------------------------------------------------------------
-- ai_settings: one row per restaurant (FR-180). Same kind as
-- restaurant_settings: members read, admins write. No delete path.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_settings (
  restaurant_id        uuid primary key references public.restaurants(id) on delete cascade,
  enabled              boolean not null default false,
  persona_name         text not null default 'Atendente' check (char_length(persona_name) between 1 and 40),
  extra_instructions   text check (char_length(extra_instructions) <= 1000),
  auto_resume_minutes  integer not null default 360 check (auto_resume_minutes between 0 and 10080),
  allow_overage        boolean not null default false,
  monthly_hard_cap     integer not null default 20000 check (monthly_hard_cap between 1 and 1000000),
  updated_at           timestamptz not null default now()
);
create trigger ai_settings_set_updated_at before update on public.ai_settings
  for each row execute function mt.set_updated_at();
select mt.apply_tenant_policies('ai_settings', 'member', 'admin', 'admin', null);

-- ---------------------------------------------------------------------------
-- Conversations: per-conversation assistant state (FR-182, FR-189, FR-190).
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column if not exists ai_mode text not null default 'auto' check (ai_mode in ('auto', 'paused')),
  add column if not exists ai_paused_at timestamptz,
  add column if not exists ai_pause_reason text check (ai_pause_reason in
    ('attendant', 'manual', 'customer_request', 'complaint', 'order_change', 'status_question',
     'unsupported_media', 'unclear', 'other', 'model', 'stale', 'quota', 'cap')),
  add column if not exists ai_pause_note text check (char_length(ai_pause_note) <= 200),
  add column if not exists ai_turn_claimed_at timestamptz;

-- ---------------------------------------------------------------------------
-- ai_runs: one row per turn. No prompts, no message text (FR-196, FR-198).
-- Members read; only the worker (system actor) inserts and updates.
-- trigger_message_id has no foreign key: messages has no (restaurant_id, id)
-- unique key to point at, and the worker sets it from the job's own message.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_runs (
  id                  uuid primary key default gen_random_uuid(),
  restaurant_id       uuid not null references public.restaurants(id) on delete cascade,
  conversation_id     uuid not null,
  trigger_message_id  uuid not null,
  status              text not null check (status in
    ('running', 'replied', 'silent', 'superseded', 'paused', 'answered', 'stale', 'blocked',
     'locked', 'stopped', 'failed')),
  model               text,
  model_calls         smallint not null default 0,
  input_tokens        integer not null default 0,
  cache_read_tokens   integer not null default 0,
  cache_write_tokens  integer not null default 0,
  output_tokens       integer not null default 0,
  billed_as           text check (billed_as in ('included', 'overage')),
  tool_calls          jsonb not null default '[]'::jsonb,
  stop_reason         text,
  error_code          text,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  constraint ai_runs_restaurant_id_id_key unique (restaurant_id, id),
  constraint ai_runs_conversation_fkey foreign key (restaurant_id, conversation_id)
    references public.conversations (restaurant_id, id) on delete cascade
);
create index if not exists ai_runs_restaurant_started on public.ai_runs (restaurant_id, started_at desc);
select mt.apply_tenant_policies('ai_runs', 'member', 'admin', 'admin', null);

-- ---------------------------------------------------------------------------
-- ai_carts: the customer's draft order. Item ids, no prices. One open cart
-- per conversation (FR-185). Members read; only the worker writes.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_carts (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references public.restaurants(id) on delete cascade,
  conversation_id    uuid not null,
  status             text not null default 'open' check (status in ('open', 'placed', 'abandoned')),
  items              jsonb not null default '[]'::jsonb,
  fulfillment        text check (fulfillment in ('delivery', 'pickup')),
  customer_name      text check (char_length(customer_name) <= 120),
  logradouro         text,
  numero             text,
  complemento        text,
  bairro             text,
  version            integer not null default 1,
  summary_message_id uuid,
  summary_version    integer,
  summary_sent_at    timestamptz,
  order_id           uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint ai_carts_conversation_fkey foreign key (restaurant_id, conversation_id)
    references public.conversations (restaurant_id, id) on delete cascade,
  constraint ai_carts_order_fkey foreign key (restaurant_id, order_id)
    references public.orders (restaurant_id, id) on delete set null (order_id)
);
create unique index if not exists ai_carts_one_open
  on public.ai_carts (restaurant_id, conversation_id) where status = 'open';
create trigger ai_carts_set_updated_at before update on public.ai_carts
  for each row execute function mt.set_updated_at();
select mt.apply_tenant_policies('ai_carts', 'member', 'admin', 'admin', null);

-- ---------------------------------------------------------------------------
-- Link a reply or an order to the run that made it (FR-192, FR-193).
-- ---------------------------------------------------------------------------
alter table public.messages add column if not exists ai_run_id uuid;
alter table public.messages add constraint messages_ai_run_fkey foreign key (restaurant_id, ai_run_id)
  references public.ai_runs (restaurant_id, id) on delete set null (ai_run_id);
alter table public.orders add column if not exists ai_run_id uuid;
alter table public.orders add constraint orders_ai_run_fkey foreign key (restaurant_id, ai_run_id)
  references public.ai_runs (restaurant_id, id) on delete set null (ai_run_id);

-- ---------------------------------------------------------------------------
-- Queue mt_ai_turns { v, restaurantId, conversationId, ... } (FR-181).
-- Same pattern and grants as migration 0012 (ADR-007). authenticated and anon
-- get nothing: queues are not a tenant surface.
-- ---------------------------------------------------------------------------
do $do$
begin
  if not exists (select 1 from pgmq.meta where queue_name = 'mt_ai_turns') then
    perform pgmq.create('mt_ai_turns');
  end if;
end
$do$;
grant select, insert, update, delete on pgmq.q_mt_ai_turns, pgmq.a_mt_ai_turns to app_service;
grant usage, select on all sequences in schema pgmq to app_service;
