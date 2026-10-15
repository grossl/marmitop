-- scripts/uatis/connect-marmitop.sql
--
-- Run once in the backend-uatis CLOUD database (Supabase dashboard → SQL
-- editor, as `postgres`). It creates the API key Marmitop needs to connect
-- WhatsApp (11.operations.md "Real sibling stacks", ADR-024).
--
-- What it does:
--   1. Checks that the cloud database has the hashed API keys migration
--      (required) and the pull-mode webhook migration (needed for
--      "Ativar webhook").
--   2. Finds your organization: one where you are `owner` or `admin` and that
--      has a connected WhatsApp number.
--   3. Creates an `admin` API key the way backend-uatis does: `obk_<env>_` plus
--      32 random bytes in base62. Only the SHA-256 hash is stored.
--   4. Shows one row: the key (shown ONCE, copy it now), the phone_number_id,
--      and the base URL to save in Marmitop → Configurações → WhatsApp.
--
-- Edit the values in step 0, then run the whole script. Running it again
-- creates another key; revoke old ones in the backend-uatis dashboard.

begin;

-- 0. Your values ---------------------------------------------------------------
create temp table marmitop_params on commit drop as
select
  'you@example.com'::text as user_email,   -- your backend-uatis cloud login
  null::uuid              as organization_id, -- null = pick automatically
  'test'::text            as environment,     -- 'test' or 'live' (only the key label)
  'Marmitop'::text        as key_name;

create temp table marmitop_result (
  organization_id uuid,
  organization_name text,
  phone_number_id text,
  phone_number text,
  api_key text,
  marmitop_base_url text,
  pull_webhooks_ready boolean
) on commit drop;

do $$
declare
  p record;
  v_user_id uuid;
  v_org record;
  v_count int;
  v_pull_ready boolean;
  v_bytes bytea;
  v_value numeric := 0;
  v_body text := '';
  v_key text;
  c_alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  c_width constant int := 43; -- ceil(32 * 8 / log2(62)), as base62Width(32)
  i int;
begin
  select * into p from marmitop_params;

  if p.environment not in ('test', 'live') then
    raise exception 'environment must be test or live, got %', p.environment;
  end if;

  -- 1. Migrations ------------------------------------------------------------
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20260815044348') then
    raise exception 'Migration 20260815044348_api_keys_hashed is missing in this database. Apply the backend-uatis migrations first (supabase db push).';
  end if;
  v_pull_ready := exists (select 1 from supabase_migrations.schema_migrations where version = '20261014120000');

  -- 2. User and organization -------------------------------------------------
  select id into v_user_id from auth.users where lower(email) = lower(p.user_email);
  if v_user_id is null then
    raise exception 'No user with e-mail % in this database.', p.user_email;
  end if;

  select count(*) into v_count
  from public.agents a
  join public.organizations_addresses oa
    on oa.organization_id = a.organization_id and oa.service = 'whatsapp' and oa.status = 'connected'
  where a.user_id = v_user_id
    and a.extra ->> 'role' in ('owner', 'admin')
    and (p.organization_id is null or a.organization_id = p.organization_id);

  if v_count <> 1 then
    raise exception 'Found % organization/number pairs where % is owner or admin with a connected WhatsApp number. Run the query at the end of this file, then set organization_id in step 0.', v_count, p.user_email;
  end if;

  select o.id, o.name, oa.address, oa.extra ->> 'phone_number' as phone_number
  into v_org
  from public.agents a
  join public.organizations o on o.id = a.organization_id
  join public.organizations_addresses oa
    on oa.organization_id = a.organization_id and oa.service = 'whatsapp' and oa.status = 'connected'
  where a.user_id = v_user_id
    and a.extra ->> 'role' in ('owner', 'admin')
    and (p.organization_id is null or a.organization_id = p.organization_id);

  -- 3. Key: 32 random bytes as one big-endian integer, in fixed-width base62 --
  v_bytes := extensions.gen_random_bytes(32);
  for i in 0 .. 31 loop
    v_value := v_value * 256 + get_byte(v_bytes, i);
  end loop;
  while v_value > 0 loop
    v_body := substr(c_alphabet, (mod(v_value, 62))::int + 1, 1) || v_body;
    v_value := div(v_value, 62);
  end loop;
  v_body := lpad(v_body, c_width, '0');
  v_key := 'obk_' || p.environment || '_' || v_body;

  insert into public.api_keys (organization_id, role, name, prefix, key_hash, created_by)
  values (v_org.id, 'admin', p.key_name, left(v_key, 8), public.api_key_hash(v_key), v_user_id);

  -- 4. Result ----------------------------------------------------------------
  insert into marmitop_result
  values (v_org.id, v_org.name, v_org.address, v_org.phone_number, v_key, 'http://127.0.0.1:3301', v_pull_ready);
end
$$;

select * from marmitop_result;

commit;

-- If the script stops at step 2, list your organizations and numbers with:
--
-- select o.id as organization_id, o.name, a.extra ->> 'role' as your_role,
--        oa.address as phone_number_id, oa.extra ->> 'phone_number' as phone_number, oa.status
-- from auth.users u
-- join public.agents a on a.user_id = u.id
-- join public.organizations o on o.id = a.organization_id
-- left join public.organizations_addresses oa on oa.organization_id = o.id and oa.service = 'whatsapp'
-- where lower(u.email) = lower('you@example.com');
