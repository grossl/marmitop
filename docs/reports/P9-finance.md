# P9 report: Finance page

Spec: ADR-020. Requirements: FR-160 to FR-169.

## Done

### T9.0 Fix: usage insert under the attendant and API-key roles

* **Symptom.** `createOrder` failed with `new row violates row-level security policy for table "usage_events"` (42501) for every attendant and every API key. The admin path worked, so an admin smoke test did not show it. P7 had added `recordUsage` to `createOrderInTx`.
* **Root cause.** `recordUsage` ran `insert ... on conflict (kind, ref_id) do nothing`. With a conflict target, Postgres also checks the new row against the table's SELECT policy. `usage_events` is admin-read only (05 "Role rules"), so the check failed for the `attendant` role. A plain insert and a bare `on conflict do nothing` both pass. This was reproduced in `psql` as `app_service` with the attendant context.
* **Fix.** `recordUsage` uses a bare `on conflict do nothing`. The only other unique key is the random `id`, so the meaning is the same. No policy changed; no migration. 05 "Role rules" gained a note: an insert into a table the caller cannot read must not use `RETURNING` or `ON CONFLICT (<columns>)`. No other table has an arbiter insert with a SELECT policy stricter than its INSERT policy.
* **Proof.** New `billing/usage.integration.test.ts` (attendant, API key, repeat counted once) failed with 42501 before the fix and passes after. In the browser, the seeded attendant created ORD-1098 from `/new-order` with its `order.created` usage row.

### Orders integration suite (first run)

`orders.integration.test.ts`: 8 pass, 17 fail before; 25 pass after. Apart from the usage bug, the failures were **test bugs**:

* The test sent delivery orders with no address. The dashboard action schema requires `logradouro` and `bairro` on purpose (the form always sends the copied address, FR-034). `base()` now sends the fixture address. The "copies the address from the customer" test now goes through `apiCreateOrder`, which reaches the shared copy in `createOrderInTx` with no address.
* The KPI test compared `delivered_at` with the fixed test day. The status trigger stamps `delivered_at` with the database clock, so the test passed only on 2026-10-13. It now pins `delivered_at`.

### Second bug found: audit context stored as a JSON string

`writeAudit` inserted `${JSON.stringify(context)}::jsonb`. Every audit row a service wrote held a jsonb **string**, not an object (seeded rows were objects). The fix is `::text::jsonb`, the cast `issue.ts` already uses. The finance test asserts `jsonb_typeof(context) = 'object'`. It fails without the fix. The fix also repairs two tests in `admin/integrations.integration.test.ts` ("audit rows carry kind and last4 only", "API keys ... create returns the full key once").

### T9.1 Specs

* 02: FR-160 to FR-169 (paid definition, `paid_at` on `entregue`, mark and clear with roles, audit, list, filters, totals, row and batch issue, admin only), FR-005 now names `/finance`, a traceability row.
* 05: `orders.paid_at`, `orders.paid_by`, the partial index, the payment-mark paragraph (backfill, `orders_paid_guard`, audit actions), the trigger rule, the role table, migration 0018 in the file list, and the RLS note from T9.0.
* 06 Appendix A: `listPaidOrders`, `getFinanceTotals`, `markOrderPaid`, `unmarkOrderPaid`, `issueInvoicesBatch`; `getOrder` returns `paidAt`.
* 09: phase P9 with tasks T9.0 to T9.5. `docs/decisions/README.md`: the ADR-020 row. 10: two test map rows.

### T9.2 Migration 0018 and seed

`supabase/migrations/0018_orders_paid_at.sql`:

* `paid_at timestamptz`, `paid_by uuid` (fk `auth.users`, on delete set null).
* Backfill `paid_at = delivered_at` for `entregue` orders.
* Partial index `orders_restaurant_paid_idx (restaurant_id, paid_at desc, id desc) where paid_at is not null`.
* `mt.orders_status_transition` sets `paid_at = now()` and `paid_by = mt.current_user_id()` on `entregue` when `paid_at` is null. The rule lives in the trigger, so the dashboard and the public API agree.
* `orders_paid_guard` (`before update of paid_at`): clearing a set `paid_at` raises 42501 unless `mt.actor_role() = 'admin'`. A connection with no service context (owner, seed) passes. A clear also nulls `paid_by`.

The T9.0 fix needed no migration, so 0018 holds only the Finance change.

`packages/db` `OrderRow` has `paid_at` and `paid_by`. The seed generator writes `paid_at` for `entregue` orders (the delivery time) and for Pix orders on today's board in `pronto` or `saiu` (paid in advance). It makes no new random calls, so the rest of the seed is unchanged. `seed:verify` gained two checks: every `entregue` order has `paid_at`, and no cancelled order has one. `bun run db:reset` applied 0018 and the verify passed.

### T9.3 Services

`packages/http/src/services/finance/`:

* `listPaidOrders` (admin): keyset by `(paid_at desc, id desc)`, 50 a page. The cursor carries `paid_at` as Postgres text, so microseconds survive. The range is local days, turned into instants in SQL (`(day)::timestamp at time zone tz`), so the partial index serves it. The default range is the current local month. The invoice state comes from the newest invoice through a lateral join.
* `getFinanceTotals` (admin): the same `FROM`/`WHERE`, grouped by payment method; all four methods are always present.
* `markOrderPaid` (attendant, admin) and `unmarkOrderPaid` (admin): lock the row, write `order.mark_paid` or `order.unmark_paid` with the old and new `paid_at`. A no-op writes no audit row. A cancelled order is `409 conflict`.
* `issueInvoicesBatch` (admin, at most 50, duplicates collapse): runs `issueInvoice` for each order in its own transaction, one after another. `queued` becomes `issued`; a blocked result with `invoice_already_active` becomes `skipped`; other blocks keep `problems` and `missingFields`; an unknown or foreign id is `blocked` with `not_found`. No transaction stays open across the loop.
* Schemas: `packages/schemas/src/finance.ts`. `getOrder` and the board return `paidAt`.

### T9.4 Dashboard

* Route `app/(app)/finance` (`page.tsx`, `actions.ts`). `requireScreen("finance")` gives the attendant a 404. Nav item "Financeiro" (admin, `Wallet` icon).
* `components/finance-page.tsx`: filters as a GET form (customer search picker, "Pago de" and "até", invoice state), six total cards (count, gross, one per method), a table with checkboxes, "Emitir NF" per row, "Emitir NF selecionadas", "Carregar mais", and a result dialog. The dialog lists blocked orders with their missing fields and an "Abrir pedido" button. The button opens the order detail dialog, where the existing invoice panel shows the short form. A Realtime `order_invoices` event refreshes the page.
* `components/orders-page.tsx`: `OrderDetailDialog` is exported and reused by Finance. It gains a "Pagamento" row with the paid badge, "Marcar como pago" (attendant and admin), and "Desmarcar pagamento" (admin). The payment actions live in `app/(app)/orders/actions.ts`.
* `components/finance-format.ts` holds the pure helpers, with tests.

## Verified

* `bun run typecheck`: 9 of 9 tasks pass.
* Unit and API tests: core 405, schemas 112, dashboard 48, api 79, worker 101, db 257 (with its integration files), config 1. All pass.
* Integration files, each run alone: finance 18/18, orders 25/25, billing usage 2/2, invoices 18/18, webhooks 14/14, reports 9/9, settings 14/14, menu 10/10, restaurant profile 8/8, worker invoice jobs 5/5.
* Browser (dev stack, seeded logins):
  * attendant: `/new-order` "Criar pedido" creates ORD-1098; `/finance` is a 404; no "Financeiro" nav item; the order detail marks ORD-1091 paid (DB `paid_by` = the attendant); no "Desmarcar pagamento" button.
  * admin: `/finance` loads 192 October orders, R$ 7.717,30; the method cards add up to the gross. The customer filter (Maria Fernanda) gives 17 orders. `invoice=issued` shows only "Em processamento" and "NF emitida". "Carregar mais" goes from 50 to 100 unique rows. A batch of ORD-1081 (complete data) and ORD-1080 (no CPF) gives 1 issued (row `queued`, badge "Em processamento") and 1 blocked ("Faltam: CPF/CNPJ"). "Abrir pedido" opens the detail. "Desmarcar pagamento" removes ORD-1080 from the list and writes `order.unmark_paid`.

## Pending

* **Nine integration tests fail outside P9**, the same with and without the P9 changes, when their files run alone against the long-lived `mt_test` database. They are in `admin/integrations` (2), `catalog/stock` (2), `messaging` (3), `public-api` (1), and `whatsapp` (1). The failures look like state left from earlier runs (stock totals from earlier items, two secret rows, extra conversations, a 500 where a 401 is expected). They need their own investigation.
* `bun run test` runs the packages in parallel against one `mt_test` database. Queue truncation in one package then breaks another (invoice and queue tests fail in parallel and pass alone). `turbo run test --concurrency=1` avoids it. CI needs one of the two.
* No Playwright e2e covers `/finance` yet.

## Risks

* The batch runs one order at a time inside one Server Action. Fifty orders take 50 short transactions, which is fine with the fake gateway (the web-nf call happens later in the worker). A slow database would make the action long, but the batch never holds a lock across orders.
* `markOrderPaid` stamps the service clock; the `entregue` rule stamps the database clock. The two can differ by clock skew between the app host and Postgres.
* A cancelled order keeps `paid_at` (ADR-020), so a refund is not visible on the page. That matches the ADR; a refund ledger is out of scope (ADR-008).
* The dev database now holds the browser-test changes: ORD-1098 created, ORD-1091 marked paid, ORD-1080 unmarked, an NFC-e queued for ORD-1081. `bun run db:reset` restores the seed.
