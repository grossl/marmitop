# P2 — Database, RLS, seed

## What was done

### Local stack

* `supabase/config.toml`: project `marmitop`. Ports follow ADR-001: API 54421, Postgres 54422, Studio 54423. The rest sit in the same block: shadow 54420, Mailpit 54424, analytics 54427 (off), edge inspector 54428 (off), pooler 54429 (off). None collides with web-nf (5532x) or backend-uatis (5632x). Realtime is on. Public sign-up is off. Bucket `menu-images` is declared (2 MiB, JPEG, PNG, WebP).
* `scripts/local-dev.ts` and root scripts: `bun run dev:stack` (start, reset, env files, verify, summary), `bun run db:reset`, `bun run dev:stack:down`, `bun run seed:generate`, `bun run seed:verify`, `bun run db:test`.
* Env files: `apps/dashboard/.env.local`, `apps/api/.env`, `apps/worker/.env`, built from `supabase status -o json`, the Auth JWKS, and `scripts/dev-seed/constants.ts`. Names follow 04.architecture.md "Configuration". `apps/*/.env.example` list the names only.
* Dev `MT_KEK`: 32 bytes `0x00..0x1f`, base64, in `scripts/dev-seed/constants.ts`.

### Migrations (`supabase/migrations/`)

| File | Contents |
|---|---|
| `0000_supabase_extensions.sql` | `pg_trgm` (schema `extensions`), `pgmq`, `pg_cron`; guarded, failures become warnings |
| `0001_roles_schema_helpers.sql` | roles; schema `mt`; Supabase default privileges in `public` revoked; `mt.current_*`, `mt.set_context`, `mt.set_updated_at`; policy builder `mt.apply_tenant_policies` |
| `0002_restaurants_members_plans.sql` | `plans` (seeded `free`, `pro`), `restaurants` (column update grant without `id`, `plan_code`), `restaurant_members`, `mt.user_restaurant_ids`, `is_member`, `is_admin`, `actor_role`, `can_write`, `memberships_for_user`, `create_restaurant`, last-admin trigger |
| `0003_settings_hours_automatic_messages.sql` | `restaurant_settings`, `business_hours`, `automatic_messages` |
| `0004_secrets_integrations_api_keys.sql` | `secrets`, `integrations_whatsapp`, `integrations_fiscal`, `api_keys`, `mt.api_key_lookup`, secret-kind trigger |
| `0005_customers_conversations_messages.sql` | `customers`, `conversations`, `messages`; `authenticated` select on the last two |
| `0006_menu.sql` | `menu_items`, `menu_item_sizes` |
| `0007_orders.sql` | `order_counters`, `orders`, `order_items`, `order_status_history`, `mt.next_order_code`, `mt.order_transition_allowed`, transition and first-history triggers, deferred subtotal triggers on `orders` and `order_items` |
| `0008_order_invoices.sql` | `order_invoices`, `order_invoices_cancel_guard` (admin-only cancel request, frozen `request_payload`) |
| `0009_stock.sql` | `stock_items` (no update grant on `current_qty`), `stock_movements`, movement trigger |
| `0010_webhooks.sql` | `webhook_endpoints`, `webhook_deliveries` |
| `0011_audit_usage_job_attempts.sql` | `audit_logs`, `usage_events`, `job_attempts`, `idempotency_records`, `rate_counters` (unlogged) |
| `0012_queues_and_jobs.sql` | four pgmq queues and grants; `mt.enqueue_whatsapp_sync`, `enqueue_invoice_polls`, `requeue_due_deliveries`, `reap_stuck_messages`, six `trim_*` functions; ten pg_cron schedules |
| `0013_realtime_publication.sql` | `orders`, `messages`, `conversations` in `supabase_realtime` |
| `0014_storage_menu_images.sql` | bucket `menu-images` and admin-only write policies on `storage.objects` |

Every tenant table uses one call to `mt.apply_tenant_policies`, which enables and forces RLS, revokes every grant, and writes the 05 "Policy pattern" per command. Policies wrap `mt.actor_role()` and `mt.can_write()` in scalar subqueries, so Postgres runs them once per statement.

### `packages/db`

* `client.ts`: `createDb` (int8 parses to `number`, safe-integer checked; numeric stays text), `withRestaurantContext(db, ctx, fn, { role? })` calling `mt.set_context`, `withUserSession` (browser path), `withoutContext`, `setRole`.
* `queue.ts`: `QUEUES`, `sendJob`, `readJobs`, `archiveJob`, `deleteJob`, `setJobVisibility`, `queueMetrics`. Unknown queue names are refused before SQL.
* `types.ts`: row types for all 29 tables, enums, `TENANT_TABLES`, `GLOBAL_TABLES`, `REALTIME_TABLES`.
* `migrate.ts`: staging and production runner (`public.schema_migrations`, sha256 checksums, advisory lock, exit 2 on drift). Exported as `@mt/db/migrate`.
* `test-database.ts`, `test-harness.ts` (`@mt/db/test-harness`): builds database `mt_test` on the local stack's cluster; fixtures with one row in every tenant table.

### Seed

`scripts/dev-seed/` generates `supabase/seed.sql` (deterministic, about 1.2 MB):

* "Marmita da Casa" (São Paulo, plan `pro`): the prototype's 8 customers with structured addresses plus 32 regulars, 12 meals and 12 drinks with sizes and weekdays, 8 stock items with movements, 8 conversations with 28 messages, today's board (the 15 prototype orders plus 3 delivered), and history: 13 days from the prototype's daily counts and six 30-day blocks from its monthly counts. 1,097 orders in total. Settings, hours, and automatic messages come from `settings-page.tsx`. Fake WhatsApp and fiscal integrations with encrypted secrets, a disabled webhook endpoint, 2 API keys (1 revoked), 6 authorized NFC-e rows, usage events, job attempts, audit rows.
* "Sabor de Minas" (Belo Horizonte, plan `free`): 7 customers, 5 menu items, 73 orders, 1 conversation, 2 stock items, a WhatsApp integration, 1 API key.
* Each restaurant has one admin and one attendant. Logins, password, API keys, `DATABASE_URL`, and `MT_KEK` are in `scripts/dev-seed/constants.ts`, the seed header, and the `dev:stack` summary. Password: `marmitop-dev-123`. Users: `admin@marmitadacasa.test`, `atendente@marmitadacasa.test`, `admin@sabordeminas.test`, `atendente@sabordeminas.test`.

## What was verified

* `supabase stop --no-backup` then `bun run dev:stack`: all 15 migrations and the seed applied; `scripts/dev-seed/verify.ts` passed every check: row counts per restaurant, 10 pg_cron jobs, the Realtime publication, the bucket, `app_service` login with RLS scoping and fail-closed reads, secret decryption under the dev KEK, password sign-in of all four users through the local Auth API, and API key lookup by hash.
* `bun run typecheck`: 9 of 9 tasks pass. `@mt/db` also typechecks `scripts/` (`scripts/tsconfig.json`).
* `bun run test`: 8 of 8 tasks pass. `@mt/db`: 234 tests across 7 files, 0 failures:
  * `rls.integration.test.ts` (181): meta-tests (every public table has RLS forced; every table with `restaurant_id` is listed and has a spec; `authenticated` and `anon` hold no write grant on any table or column; `authenticated` reads only the three Realtime tables; `app_service` is `nobypassrls`; every definer function pins `search_path`; nothing in `mt` is executable by `public`). For each of the 27 tenant tables: no cross-tenant read, update, delete, or insert for A's admin or system actor; fail closed without context; the browser path never writes. The 05 role table checked for admin, attendant, API key, system, revoked key, foreign key, and non-member. Column grants, `plans`, helpers, last-admin guard, secret-kind guard.
  * `orders.integration.test.ts` (18): order codes per restaurant, `ORD-999` → `ORD-1000`, 8 concurrent orders get gapless codes, foreign and revoked callers refused; all 84 distinct-status triples through `mt.order_transition_allowed` and 78 reachable ones through the trigger; `packages/core` `canTransition` agrees with the database on all 98 triples; history rows, no-op on the same status, `delivered_at` and `cancelled_at`, API key actor; subtotal checked at commit for orders and items.
  * `stock-invoices.integration.test.ts` (11): balances, oversell refused, concurrent movements serialize, cross-tenant item refused; attendant and API key cannot request an invoice cancellation, admin and system can; `request_payload` frozen.
  * `queue.integration.test.ts` (13): send, read, archive, delete, delay, visibility, metrics; rolled-back send never appears; `app_service` cannot drop or purge a queue; the browser role has no queue access; each scheduled function, called directly.
  * `migrate.integration.test.ts` (1), `dev-seed.test.ts` (9, seed drift, envelope layout, `packages/core` `EnvelopeSecretBox` opens every seeded secret, env file names), `index.test.ts` (1).
* Mutation check: weakening one table's RLS, one policy, and adding a write grant to `authenticated` in `mt_test` made 9 tests fail, so the suite detects those regressions.
* Watched fail before the fix: order code, transition, history and subtotal tests (17 red), stock and invoice guard tests (8 red). The first green run exposed the `lpad` truncation bug in the 05 order-code SQL.

## Spec changes

* 05 "Order code": `lpad(n, 3, '0')` truncates `1000` to `100`. The SQL now pads only below 100.
* 05 helper table: `mt.next_order_code` is `security definer` (no grant exists on `order_counters`) and checks the restaurant and the attendant rule itself. Added `mt.current_api_key_id`, `mt.order_transition_allowed`, `mt.check_order_subtotal`, `mt.apply_tenant_policies`.
* 05 role rules: `webhook_endpoints` read is `member`, `webhook_deliveries` insert is `attendant`. Producers run as attendants and API keys; the old rule made every attendant status change fail its webhook insert.
* 05: `stock_items.current_qty` has no update grant; the movement trigger is `security definer` and checks the item's restaurant. `secrets` has no update grant. `order_invoices_cancel_guard` fires on insert and update, covers all three `cancel_*` columns, raises `42501`, and raises `23514` on a changed `request_payload`. Supabase default privileges are revoked, so `service_role` holds no grant on Marmitop tables.
* 10 and 11: the integration harness is database `mt_test` on the local Supabase cluster, not an `initdb` scratch cluster. The machine has no Postgres binaries, and NFR-052 already asks for the local stack. 10 "CI" now needs a Postgres image with pgmq (`supabase/postgres`).

## Open risks

* Integration tests need the local stack. Without it, `@mt/db:test` fails with "Start the local stack with `bun run dev:stack`". CI needs a `supabase/postgres` service container and `TEST_DATABASE_URL`.
* Turbo cache: `turbo.json` `globalDependencies` lists `supabase/migrations/**` only. Changes to `scripts/**` or `supabase/seed.sql` do not invalidate `@mt/db` typecheck or test caches. Add both (outside my file scope).
* `api_keys.last_used_at`: an `api_key` actor is an attendant, and `api_keys` writes are admin-only. `apps/api` must update it in a `system` context or through a definer function (P7).
* Cross-tenant references: foreign keys such as `messages.conversation_id` do not check that the parent has the same `restaurant_id`. RLS stops reads and writes across tenants, but a buggy service could link a row to another tenant's parent id. Composite foreign keys `(restaurant_id, id)` would close this; it needs a spec change.
* `orders`, `messages`, `conversations` allow `delete` for attendants, per the 05 role table, while 05 "Realtime publication" assumes rows are never deleted. Either drop the delete grant or accept the Realtime delete gap.
* The seed derives data keys and IVs from the dev KEK so the file is stable. That is safe only for committed dev fixtures. Production sealing is `packages/core` `EnvelopeSecretBox` (random keys); a test proves both use one format.
* `supabase/seed.sql` is about 1.2 MB of generated SQL. It regenerates byte-identically; `dev-seed.test.ts` fails on drift.
* The seeded WhatsApp integrations are `connected`, so pg_cron enqueues one `mt_sync` message per restaurant (deduplicated). Nothing consumes it until the worker runs.
* Nothing was committed (chief commits).
