-- 0004_secrets_integrations_api_keys.sql
--
-- secrets, integrations_whatsapp, integrations_fiscal, api_keys,
-- mt.api_key_lookup and the secret-kind trigger (05.data-model.md, ADR-009,
-- ADR-012, 07.security.md). FR-085–099, FR-140–149.

-- ---------------------------------------------------------------------------
-- secrets (envelope-encrypted, ADR-012)
-- ---------------------------------------------------------------------------

create table if not exists public.secrets (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  kind          text not null check (kind in (
                  'uatis_api_key', 'uatis_webhook_secret', 'webnf_api_key',
                  'webnf_webhook_secret', 'outbound_webhook_secret')),
  ciphertext    bytea not null,
  iv            bytea not null check (octet_length(iv) = 12),
  wrapped_key   bytea not null,
  kek_version   smallint not null default 1,
  last4         text not null,
  created_at    timestamptz not null default now(),
  constraint secrets_restaurant_id_id_key unique (restaurant_id, id)
);

create index if not exists secrets_restaurant_kind_idx on public.secrets (restaurant_id, kind);

-- Rows are never updated: a rotation inserts a new row and deletes the old one.
select mt.apply_tenant_policies('secrets', 'admin', 'admin', null, 'admin');

-- ---------------------------------------------------------------------------
-- Secret-kind guard, shared by integrations_* and webhook_endpoints (0010)
-- ---------------------------------------------------------------------------
-- Trigger arguments come in pairs: column name, required kind. Each column
-- must point at a secrets row of that kind in the same restaurant (T14 in
-- 07.security.md). Security definer so the check sees the row whatever the
-- caller's read policy on secrets says.

create or replace function mt.check_secret_refs()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_row jsonb := pg_catalog.to_jsonb(new);
  v_i integer := 0;
  v_col text;
  v_kind text;
  v_id uuid;
begin
  while v_i < tg_nargs loop
    v_col := tg_argv[v_i];
    v_kind := tg_argv[v_i + 1];
    v_id := (v_row ->> v_col)::uuid;
    if v_id is not null and not exists (
      select 1 from public.secrets s
      where s.id = v_id
        and s.kind = v_kind
        and s.restaurant_id = new.restaurant_id
    ) then
      raise exception '%.% must reference a % secret of the same restaurant', tg_table_name, v_col, v_kind
        using errcode = '23514', constraint = tg_table_name || '_secret_kind';
    end if;
    v_i := v_i + 2;
  end loop;
  return new;
end
$fn$;

revoke all on function mt.check_secret_refs() from public;

-- ---------------------------------------------------------------------------
-- integrations_whatsapp (backend-uatis, ADR-002)
-- ---------------------------------------------------------------------------

create table if not exists public.integrations_whatsapp (
  restaurant_id     uuid primary key references public.restaurants(id) on delete cascade,
  base_url          text not null check (base_url ~ '^https?://'),
  api_key_secret_id uuid not null,
  webhook_secret_id uuid not null,
  phone_number_id   text not null,
  status            text not null default 'disconnected' check (status in ('disconnected', 'connected', 'error')),
  last_error        text,
  last_sync_cursor  timestamptz,
  last_synced_at    timestamptz,
  updated_at        timestamptz not null default now(),
  constraint integrations_whatsapp_api_key_secret_fkey foreign key (restaurant_id, api_key_secret_id)
    references public.secrets (restaurant_id, id) on delete restrict,
  constraint integrations_whatsapp_webhook_secret_fkey foreign key (restaurant_id, webhook_secret_id)
    references public.secrets (restaurant_id, id) on delete restrict
);

create trigger integrations_whatsapp_set_updated_at
  before update on public.integrations_whatsapp
  for each row execute function mt.set_updated_at();

create trigger integrations_whatsapp_secret_kind
  before insert or update on public.integrations_whatsapp
  for each row execute function mt.check_secret_refs(
    'api_key_secret_id', 'uatis_api_key',
    'webhook_secret_id', 'uatis_webhook_secret');

select mt.apply_tenant_policies('integrations_whatsapp', 'admin', 'admin', 'admin', 'admin');

-- ---------------------------------------------------------------------------
-- integrations_fiscal (web-nf, ADR-003, ADR-016)
-- ---------------------------------------------------------------------------

create table if not exists public.integrations_fiscal (
  restaurant_id      uuid primary key references public.restaurants(id) on delete cascade,
  base_url           text not null check (base_url ~ '^https?://'),
  api_key_secret_id  uuid not null,
  webhook_secret_id  uuid not null,
  environment        text not null default 'homologacao' check (environment in ('homologacao', 'producao')),
  nfce_serie         integer not null default 1 check (nfce_serie between 1 and 999),
  nfe_serie          integer not null default 1 check (nfe_serie between 1 and 999),
  default_ncm        text not null check (default_ncm ~ '^[0-9]{8}$'),
  default_cfop       text not null check (default_cfop ~ '^[0-9]{4}$'),
  default_csosn      text check (default_csosn ~ '^[0-9]{3}$'),
  default_pis_cst    text not null check (default_pis_cst ~ '^[0-9]{2}$'),
  default_cofins_cst text not null check (default_cofins_cst ~ '^[0-9]{2}$'),
  delivery_fee_mode  text not null default 'item' check (delivery_fee_mode in ('item', 'none')),
  status             text not null default 'disconnected' check (status in ('disconnected', 'connected', 'error')),
  last_error         text,
  updated_at         timestamptz not null default now(),
  constraint integrations_fiscal_api_key_secret_fkey foreign key (restaurant_id, api_key_secret_id)
    references public.secrets (restaurant_id, id) on delete restrict,
  constraint integrations_fiscal_webhook_secret_fkey foreign key (restaurant_id, webhook_secret_id)
    references public.secrets (restaurant_id, id) on delete restrict
);

create trigger integrations_fiscal_set_updated_at
  before update on public.integrations_fiscal
  for each row execute function mt.set_updated_at();

create trigger integrations_fiscal_secret_kind
  before insert or update on public.integrations_fiscal
  for each row execute function mt.check_secret_refs(
    'api_key_secret_id', 'webnf_api_key',
    'webhook_secret_id', 'webnf_webhook_secret');

-- Member-readable: the attendant's "Emitir NF" screen needs series and
-- environment. The row holds secret ids, never secret values.
select mt.apply_tenant_policies('integrations_fiscal', 'member', 'admin', 'admin', 'admin');

-- ---------------------------------------------------------------------------
-- api_keys (ADR-009, ADR-017)
-- ---------------------------------------------------------------------------

create table if not exists public.api_keys (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name          text not null,
  prefix        text not null,
  hash          text not null check (hash ~ '^[0-9a-f]{64}$'),
  environment   text not null check (environment in ('live', 'test')),
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  constraint api_keys_hash_key unique (hash),
  constraint api_keys_restaurant_id_id_key unique (restaurant_id, id)
);

create index if not exists api_keys_restaurant_created_idx on public.api_keys (restaurant_id, created_at desc);

select mt.apply_tenant_policies('api_keys', 'admin', 'admin', 'admin', 'admin');

-- The only way to resolve a restaurant from an API key: one row through the
-- unique hash index, before any restaurant context exists (ADR-017).
create or replace function mt.api_key_lookup(p_hash text)
returns table (id uuid, restaurant_id uuid, environment text, revoked_at timestamptz)
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select k.id, k.restaurant_id, k.environment, k.revoked_at
  from public.api_keys k
  where k.hash = p_hash
$fn$;

revoke all on function mt.api_key_lookup(text) from public;
grant execute on function mt.api_key_lookup(text) to app_service;

-- Records that a key was used (FR-089 "last use"). An API key actor is an
-- attendant and api_keys writes are admin-only, so apps/api calls this definer
-- function instead. It writes last_used_at only, only for a key of the current
-- restaurant, and at most once a minute per key, so a busy key does not turn
-- every request into a row update. Returns true when it wrote.
create or replace function mt.touch_api_key(p_key_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_count integer;
begin
  update public.api_keys k
     set last_used_at = pg_catalog.now()
   where k.id = p_key_id
     and k.restaurant_id = mt.current_restaurant_id()
     and (k.last_used_at is null or k.last_used_at < pg_catalog.now() - interval '60 seconds');
  get diagnostics v_count = row_count;
  return v_count > 0;
end
$fn$;

revoke all on function mt.touch_api_key(uuid) from public;
grant execute on function mt.touch_api_key(uuid) to app_service;
