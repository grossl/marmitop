-- supabase/seed.sql
--
-- GENERATED FILE. Do not edit by hand. Regenerate with `bun run seed:generate`
-- (scripts/dev-seed/generate.ts). `supabase db reset` runs it after the
-- migrations, as the migration owner, so the inserts bypass RLS the way a DBA
-- does. The applications still connect as `app_service` (nobypassrls).
--
-- Accounts and configuration only (ADR-024). Menu, stock, customers,
-- conversations, orders, and invoices start empty.
--
-- ===========================================================================
-- LOCAL DEVELOPMENT CREDENTIALS: for the `supabase start` stack only
-- ===========================================================================
-- Committed on purpose. None of these values opens anything outside a
-- developer's machine. Do not copy them into a deployed environment.
--
-- Dashboard sign-in (http://localhost:3100). Password for every user: qweqwe
--   qwe@qwe.com                    admin     Marmita da Casa
--   atendente@marmitadacasa.test   attendant Marmita da Casa
--   admin@sabordeminas.test        admin     Sabor de Minas
--   atendente@sabordeminas.test    attendant Sabor de Minas
--
-- DATABASE_URL=postgresql://app_service:marmitop-dev-app-service@127.0.0.1:54422/postgres
-- MT_KEK=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=
--
-- Public API keys (Authorization: Bearer ...):
--   Marmita da Casa: mtk_test_CasaDev0000000000000000000000001
--   Marmita da Casa: mtk_test_CasaDev0000000000000000000000002  [revoked: expect 401]
--   Sabor de Minas: mtk_test_MinasDev000000000000000000000003
--
-- Marmita da Casa fiscal integration: web-nf http://127.0.0.1:3002, homologacao
-- (web-nf's own dev key). WhatsApp is not seeded: connect it in Configurações.
-- ===========================================================================

set standard_conforming_strings = on;

begin;

create function pg_temp.seed_at(p_days integer, p_hour integer, p_minute integer)
returns timestamptz
language sql
stable
as $fn$
  select (date_trunc('day', now() at time zone 'America/Sao_Paulo')
          - make_interval(days => p_days) + make_interval(hours => p_hour, mins => p_minute))
         at time zone 'America/Sao_Paulo'
$fn$;


-- ---------------------------------------------------------------------------
-- Local wiring
-- ---------------------------------------------------------------------------
-- Migration 0001 creates app_service `nologin`; each environment attaches a
-- password out of band. On the local stack the seed is that out of band.
alter role app_service with login password 'marmitop-dev-app-service';

-- ---------------------------------------------------------------------------
-- auth.users + auth.identities
-- ---------------------------------------------------------------------------
-- Email and password, already confirmed.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token
) values
  ('00000000-0000-0000-0000-000000000000', 'aaaa0001-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'qwe@qwe.com', extensions.crypt('qweqwe', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Carla Mendes"}'::jsonb, now(), now(), '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'aaaa0001-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'atendente@marmitadacasa.test', extensions.crypt('qweqwe', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Diego Rocha"}'::jsonb, now(), now(), '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'aaaa0001-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'admin@sabordeminas.test', extensions.crypt('qweqwe', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Helena Prado"}'::jsonb, now(), now(), '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'aaaa0001-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'atendente@sabordeminas.test', extensions.crypt('qweqwe', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Igor Lima"}'::jsonb, now(), now(), '', '', '', '', '', '', '', '');

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
) values
  ('aaaa0002-0000-4000-8000-000000000001', 'aaaa0001-0000-4000-8000-000000000001', 'aaaa0001-0000-4000-8000-000000000001', 'email', '{"email":"qwe@qwe.com","email_verified":true,"phone_verified":false,"sub":"aaaa0001-0000-4000-8000-000000000001"}'::jsonb, now(), now(), now()),
  ('aaaa0002-0000-4000-8000-000000000002', 'aaaa0001-0000-4000-8000-000000000002', 'aaaa0001-0000-4000-8000-000000000002', 'email', '{"email":"atendente@marmitadacasa.test","email_verified":true,"phone_verified":false,"sub":"aaaa0001-0000-4000-8000-000000000002"}'::jsonb, now(), now(), now()),
  ('aaaa0002-0000-4000-8000-000000000003', 'aaaa0001-0000-4000-8000-000000000003', 'aaaa0001-0000-4000-8000-000000000003', 'email', '{"email":"admin@sabordeminas.test","email_verified":true,"phone_verified":false,"sub":"aaaa0001-0000-4000-8000-000000000003"}'::jsonb, now(), now(), now()),
  ('aaaa0002-0000-4000-8000-000000000004', 'aaaa0001-0000-4000-8000-000000000004', 'aaaa0001-0000-4000-8000-000000000004', 'email', '{"email":"atendente@sabordeminas.test","email_verified":true,"phone_verified":false,"sub":"aaaa0001-0000-4000-8000-000000000004"}'::jsonb, now(), now(), now());

-- ---------------------------------------------------------------------------
-- restaurants, members, settings, hours, automatic messages (FR-009, FR-080–084)
-- ---------------------------------------------------------------------------
insert into public.restaurants (
  id, name, phone, email, address, cidade, uf, codigo_municipio, plan_code
) values
  ('bbbb0001-0000-4000-8000-000000000001', 'Marmita da Casa', '(11) 99999-0000', 'contato@marmitadacasa.com.br', 'Rua das Flores, 342 - Vila Madalena', 'São Paulo', 'SP', '3550308', 'pro'),
  ('bbbb0001-0000-4000-8000-000000000002', 'Sabor de Minas', '(31) 98888-1111', 'contato@sabordeminas.com.br', 'Rua da Bahia, 1200 - Centro', 'Belo Horizonte', 'MG', '3106200', 'free');

insert into public.restaurant_members (
  id, restaurant_id, user_id, role
) values
  ('bbbb0002-0000-4000-8000-000000000001', 'bbbb0001-0000-4000-8000-000000000001', 'aaaa0001-0000-4000-8000-000000000001', 'admin'),
  ('bbbb0002-0000-4000-8000-000000000002', 'bbbb0001-0000-4000-8000-000000000001', 'aaaa0001-0000-4000-8000-000000000002', 'attendant'),
  ('bbbb0002-0000-4000-8000-000000000003', 'bbbb0001-0000-4000-8000-000000000002', 'aaaa0001-0000-4000-8000-000000000003', 'admin'),
  ('bbbb0002-0000-4000-8000-000000000004', 'bbbb0001-0000-4000-8000-000000000002', 'aaaa0001-0000-4000-8000-000000000004', 'attendant');

insert into public.restaurant_settings (
  restaurant_id, auto_accept, allow_pickup, show_delivery_estimate, delivery_estimate_minutes, delivery_fee_cents, timezone
) values
  ('bbbb0001-0000-4000-8000-000000000001', true, true, true, 45, 500, 'America/Sao_Paulo'),
  ('bbbb0001-0000-4000-8000-000000000002', false, true, true, 50, 700, 'America/Sao_Paulo');

insert into public.business_hours (
  id, restaurant_id, weekday, enabled, opens_at, closes_at
) values
  ('bbbb0003-0000-4000-8000-000000000001', 'bbbb0001-0000-4000-8000-000000000001', 1, true, '08:00', '18:00'),
  ('bbbb0003-0000-4000-8000-000000000002', 'bbbb0001-0000-4000-8000-000000000001', 2, true, '08:00', '18:00'),
  ('bbbb0003-0000-4000-8000-000000000003', 'bbbb0001-0000-4000-8000-000000000001', 3, true, '08:00', '18:00'),
  ('bbbb0003-0000-4000-8000-000000000004', 'bbbb0001-0000-4000-8000-000000000001', 4, true, '08:00', '18:00'),
  ('bbbb0003-0000-4000-8000-000000000005', 'bbbb0001-0000-4000-8000-000000000001', 5, true, '08:00', '18:00'),
  ('bbbb0003-0000-4000-8000-000000000006', 'bbbb0001-0000-4000-8000-000000000001', 6, true, '09:00', '15:00'),
  ('bbbb0003-0000-4000-8000-000000000007', 'bbbb0001-0000-4000-8000-000000000001', 0, false, '09:00', '14:00'),
  ('bbbb0003-0000-4000-8000-000000000008', 'bbbb0001-0000-4000-8000-000000000002', 0, true, '11:00', '15:00'),
  ('bbbb0003-0000-4000-8000-000000000009', 'bbbb0001-0000-4000-8000-000000000002', 1, false, '11:00', '15:00'),
  ('bbbb0003-0000-4000-8000-000000000010', 'bbbb0001-0000-4000-8000-000000000002', 2, true, '11:00', '15:00'),
  ('bbbb0003-0000-4000-8000-000000000011', 'bbbb0001-0000-4000-8000-000000000002', 3, true, '11:00', '15:00'),
  ('bbbb0003-0000-4000-8000-000000000012', 'bbbb0001-0000-4000-8000-000000000002', 4, true, '11:00', '15:00'),
  ('bbbb0003-0000-4000-8000-000000000013', 'bbbb0001-0000-4000-8000-000000000002', 5, true, '11:00', '22:00'),
  ('bbbb0003-0000-4000-8000-000000000014', 'bbbb0001-0000-4000-8000-000000000002', 6, true, '11:00', '22:00');

insert into public.automatic_messages (
  id, restaurant_id, kind, enabled, body
) values
  ('bbbb0004-0000-4000-8000-000000000001', 'bbbb0001-0000-4000-8000-000000000001', 'welcome', true, 'Olá! Bem-vindo à {{restaurante}}. Como podemos ajudar?'),
  ('bbbb0004-0000-4000-8000-000000000002', 'bbbb0001-0000-4000-8000-000000000001', 'closed', true, 'Olá! Estamos fora do nosso horário de atendimento. Retornaremos assim que abrirmos.'),
  ('bbbb0004-0000-4000-8000-000000000003', 'bbbb0001-0000-4000-8000-000000000001', 'order_received', true, 'Recebemos seu pedido! Em breve confirmaremos os detalhes.'),
  ('bbbb0004-0000-4000-8000-000000000004', 'bbbb0001-0000-4000-8000-000000000002', 'welcome', true, 'Uai, {{nome}}! Bem-vindo ao {{restaurante}}. O que vai ser hoje?'),
  ('bbbb0004-0000-4000-8000-000000000005', 'bbbb0001-0000-4000-8000-000000000002', 'closed', true, 'Estamos fechados agora. Abrimos de terça a domingo, a partir das 11h.'),
  ('bbbb0004-0000-4000-8000-000000000006', 'bbbb0001-0000-4000-8000-000000000002', 'order_received', false, 'Pedido {{pedido}} recebido! Já vamos preparar.'),
  ('bbbb0004-0000-4000-8000-000000000007', 'bbbb0001-0000-4000-8000-000000000001', 'order_confirmed', true, 'Olá {{nome}}! Seu pedido {{pedido}} foi confirmado e logo entra em preparo.'),
  ('bbbb0004-0000-4000-8000-000000000008', 'bbbb0001-0000-4000-8000-000000000001', 'order_preparing', true, 'Seu pedido {{pedido}} está sendo preparado.'),
  ('bbbb0004-0000-4000-8000-000000000009', 'bbbb0001-0000-4000-8000-000000000001', 'order_ready', true, 'Seu pedido {{pedido}} está pronto! Pode vir retirar no {{restaurante}}.'),
  ('bbbb0004-0000-4000-8000-000000000010', 'bbbb0001-0000-4000-8000-000000000001', 'order_out_for_delivery', true, 'Seu pedido {{pedido}} saiu para entrega!'),
  ('bbbb0004-0000-4000-8000-000000000011', 'bbbb0001-0000-4000-8000-000000000001', 'order_delivered', true, 'Pedido {{pedido}} entregue. Obrigado pela preferência, {{nome}}!'),
  ('bbbb0004-0000-4000-8000-000000000012', 'bbbb0001-0000-4000-8000-000000000001', 'order_cancelled', true, 'Seu pedido {{pedido}} foi cancelado. Se tiver dúvidas, responda esta mensagem.'),
  ('bbbb0004-0000-4000-8000-000000000013', 'bbbb0001-0000-4000-8000-000000000002', 'order_confirmed', true, 'Olá {{nome}}! Seu pedido {{pedido}} foi confirmado e logo entra em preparo.'),
  ('bbbb0004-0000-4000-8000-000000000014', 'bbbb0001-0000-4000-8000-000000000002', 'order_preparing', true, 'Seu pedido {{pedido}} está sendo preparado.'),
  ('bbbb0004-0000-4000-8000-000000000015', 'bbbb0001-0000-4000-8000-000000000002', 'order_ready', true, 'Seu pedido {{pedido}} está pronto! Pode vir retirar no {{restaurante}}.'),
  ('bbbb0004-0000-4000-8000-000000000016', 'bbbb0001-0000-4000-8000-000000000002', 'order_out_for_delivery', true, 'Seu pedido {{pedido}} saiu para entrega!'),
  ('bbbb0004-0000-4000-8000-000000000017', 'bbbb0001-0000-4000-8000-000000000002', 'order_delivered', true, 'Pedido {{pedido}} entregue. Obrigado pela preferência, {{nome}}!'),
  ('bbbb0004-0000-4000-8000-000000000018', 'bbbb0001-0000-4000-8000-000000000002', 'order_cancelled', true, 'Seu pedido {{pedido}} foi cancelado. Se tiver dúvidas, responda esta mensagem.');

-- ---------------------------------------------------------------------------
-- secrets and integrations (ADR-012, ADR-024)
-- ---------------------------------------------------------------------------
-- Envelope-encrypted under the dev MT_KEK (scripts/dev-seed/envelope.ts).
-- Marmita da Casa points at the local web-nf; run it with MT_WEBNF_FAKE=0.
-- No WhatsApp integration: backend-uatis has no seeded key that works (ADR-024).
insert into public.secrets (
  id, restaurant_id, kind, ciphertext, iv, wrapped_key, kek_version, last4
) values
  ('cccc0001-0000-4000-8000-000000000001', 'bbbb0001-0000-4000-8000-000000000001', 'webnf_api_key', '\x753b2bebae83b09c40e5708dd770748b89a9b2941dd180f8a8655b763e8f5f6569a31eac246d63ed0e7d90d12e90d99a74b985fe42753e96606b'::bytea, '\x3c449a0f9c6bc5bfa0a9141f'::bytea, '\x526f5e98f7a8d72210122f51db4d9a1c50fb2665c4f612cddbc4b8850eb60ac74a23badb5e9d3ce9dc81db096e84742576852020083fee7966ae17b8'::bytea, 1, 'o55F'),
  ('cccc0001-0000-4000-8000-000000000002', 'bbbb0001-0000-4000-8000-000000000001', 'webnf_webhook_secret', '\x57f232d3ad1c7fbfa8975932656427abb37e3c6fb3757bea9ca321a7625f95a9df2c05e741f738'::bytea, '\xf2a691ca251235b76366596e'::bytea, '\xad70f9ee07aa300e08fefb70925e509f01ae6cfd8b253bafefdeb3a8b7c59192d97eef9f02104fd7204933504957ead2e197bb5ade6f84064005154e'::bytea, 1, 'cret');

insert into public.integrations_fiscal (
  restaurant_id, base_url, api_key_secret_id, webhook_secret_id, environment, nfce_serie, nfe_serie, default_ncm, default_cfop, default_csosn, default_pis_cst, default_cofins_cst, delivery_fee_mode, status
) values
  ('bbbb0001-0000-4000-8000-000000000001', 'http://127.0.0.1:3002', 'cccc0001-0000-4000-8000-000000000001', 'cccc0001-0000-4000-8000-000000000002', 'homologacao', 1, 1, '21069090', '5102', '102', '49', '49', 'item', 'connected');

insert into public.api_keys (
  id, restaurant_id, name, prefix, hash, environment, created_by, created_at, revoked_at
) values
  ('cccc0002-0000-4000-8000-000000000001', 'bbbb0001-0000-4000-8000-000000000001', 'Integração local', 'mtk_test_CasaDev0', '4aa13b07424a57fcfd2dfae8c5d769f53cf3deb0f9d61a20676d079a2c843ade', 'test', 'aaaa0001-0000-4000-8000-000000000001', pg_temp.seed_at(20, 10, 0), null),
  ('cccc0002-0000-4000-8000-000000000002', 'bbbb0001-0000-4000-8000-000000000001', 'Chave antiga', 'mtk_test_CasaDev0', '1c77917fd3ea2f28fac00dde4b5e0f15b684f820be0744641e1640868cd6aa96', 'test', 'aaaa0001-0000-4000-8000-000000000001', pg_temp.seed_at(40, 10, 0), pg_temp.seed_at(21, 10, 0)),
  ('cccc0002-0000-4000-8000-000000000003', 'bbbb0001-0000-4000-8000-000000000002', 'Integração local', 'mtk_test_MinasDev', '12a3b085ffa565546fb2a892c767580a7edbdea1febeab57e30772cbf0421dca', 'test', 'aaaa0001-0000-4000-8000-000000000003', pg_temp.seed_at(20, 10, 0), null);

commit;
