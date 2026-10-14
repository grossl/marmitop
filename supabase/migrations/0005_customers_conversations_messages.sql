-- 0005_customers_conversations_messages.sql
--
-- customers, conversations, messages (05.data-model.md, ADR-002, ADR-014,
-- ADR-016). FR-010–019, FR-040–049. conversations and messages are also
-- readable by `authenticated` for Realtime (ADR-004, ADR-017).

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------

create table if not exists public.customers (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants(id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 120),
  phone            text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  email            text,
  cpf_cnpj         text check (cpf_cnpj ~ '^([0-9]{11}|[0-9]{14})$'),
  cep              text check (cep ~ '^[0-9]{8}$'),
  logradouro       text,
  numero           text,
  complemento      text,
  bairro           text,
  cidade           text,
  uf               text check (uf ~ '^[A-Z]{2}$'),
  codigo_municipio text check (codigo_municipio ~ '^[0-9]{7}$'),
  notes            text check (char_length(notes) <= 1000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint customers_restaurant_phone_key unique (restaurant_id, phone),
  constraint customers_restaurant_id_id_key unique (restaurant_id, id)
);

create index if not exists customers_name_trgm_idx on public.customers using gin (name extensions.gin_trgm_ops);

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function mt.set_updated_at();

-- No delete grant: rows are never deleted in v1 (05.data-model.md "Role rules", ADR-018).
select mt.apply_tenant_policies('customers', 'member', 'attendant', 'attendant', null);

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------

create table if not exists public.conversations (
  id                    uuid primary key default gen_random_uuid(),
  restaurant_id         uuid not null references public.restaurants(id) on delete cascade,
  customer_id           uuid not null,
  external_id           text,
  last_message_at       timestamptz,
  last_message_preview  text check (char_length(last_message_preview) <= 120),
  unread_count          integer not null default 0 check (unread_count >= 0),
  last_inbound_at       timestamptz,
  closed_notice_sent_at timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint conversations_restaurant_customer_key unique (restaurant_id, customer_id),
  constraint conversations_restaurant_id_id_key unique (restaurant_id, id),
  constraint conversations_customer_fkey foreign key (restaurant_id, customer_id)
    references public.customers (restaurant_id, id) on delete restrict
);

create unique index if not exists conversations_restaurant_external_key
  on public.conversations (restaurant_id, external_id) where external_id is not null;
create index if not exists conversations_restaurant_last_message_idx
  on public.conversations (restaurant_id, last_message_at desc);

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function mt.set_updated_at();

-- No delete grant: rows are never deleted in v1 (05.data-model.md "Role rules", ADR-018).
select mt.apply_tenant_policies('conversations', 'member', 'attendant', 'attendant', null);

grant select on table public.conversations to authenticated;
create policy conversations_user_select on public.conversations for select to authenticated
  using (restaurant_id in (select mt.user_restaurant_ids()));

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
-- messages.order_id gets its foreign key in 0007, once orders exists.

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  conversation_id uuid not null,
  direction       text not null check (direction in ('in', 'out')),
  body            text not null check (char_length(body) between 1 and 4096),
  status          text not null check (status in ('pending', 'sent', 'delivered', 'read', 'failed')),
  external_id     text,
  order_id        uuid,
  sent_by         uuid references auth.users(id) on delete set null,
  automatic_kind  text check (automatic_kind in ('welcome', 'closed', 'order_received')),
  template_name   text,
  error_code      text,
  error_message   text check (char_length(error_message) <= 200),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint messages_sent_by_outbound check (direction = 'out' or sent_by is null),
  constraint messages_conversation_fkey foreign key (restaurant_id, conversation_id)
    references public.conversations (restaurant_id, id) on delete cascade
);

create unique index if not exists messages_restaurant_external_key
  on public.messages (restaurant_id, external_id) where external_id is not null;
create index if not exists messages_restaurant_conversation_created_idx
  on public.messages (restaurant_id, conversation_id, created_at desc);

create trigger messages_set_updated_at
  before update on public.messages
  for each row execute function mt.set_updated_at();

-- No delete grant: rows are never deleted in v1 (05.data-model.md "Role rules", ADR-018).
select mt.apply_tenant_policies('messages', 'member', 'attendant', 'attendant', null);

grant select on table public.messages to authenticated;
create policy messages_user_select on public.messages for select to authenticated
  using (restaurant_id in (select mt.user_restaurant_ids()));
