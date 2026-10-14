# P6 report: invoices through web-nf

## Done

### Adapter (T6.2)

* `packages/http/src/adapters/web-nf-gateway.ts`: `WebNfGateway` implements the `InvoiceGateway` port over the web-nf generation API. Every call goes through `safeFetch`.
  * `createInvoice`: `POST /v1/invoices` with `Authorization: Bearer`, `Idempotency-Key`, and the body byte for byte. It reads `202 { id, status }` and the `Idempotency-Replayed` header.
  * `getInvoice`: `GET /v1/invoices/{id}` (path-encoded). It maps `numero`, `serie` (a non-numeric series becomes null), `chave_acesso`, `error`, `files.xml`, `files.pdf`, `authorized_at`, and `events[]`.
  * `cancelInvoice`: `POST /v1/invoices/{id}/events` with `{ type: "cancelamento", justificativa }` and its own key. web-nf answers the event (`202 queued`), not the invoice.
  * `testConnection`: the generation API has no list route, so it reads an id that cannot exist. `404` means the key passed auth.
  * Errors throw `GatewayError` with web-nf's `error.code`, `details[]` (new optional field on `GatewayError`), and `Retry-After`. An unreadable `2xx` is a `network_error`, so the retry replays with the same key.
* `packages/http/src/testing/fake-web-nf-server.ts`: `FakeWebNfServer` (`Bun.serve`) returns the shapes web-nf really returns (read from web-nf `apps/generation-api`, `packages/http/src/services/get-invoice.ts`, `create-event.ts`). The key binds to the SHA-256 of the raw body, as in web-nf.
* The adapter passes the `@mt/core/contracts` InvoiceGateway suite against the fake server. `createServiceDeps` returns `WebNfGateway` unless `MT_WEBNF_FAKE=1`.

### Core (pure)

`packages/core/src/fiscal/invoice-lifecycle.ts`:

* `decideInvoiceUpdate`: the one status rule (FR-136). A non-final status moves forward only. A final status never moves back. The only final-to-final move is `authorized` → `cancelled`. The same final status again only fills empty fields. `received` is stored as received; the UI reads it as "Em processamento".
* `parseNfWebhookEvent`, `nfWebhookStatus`, `latestCancelOutcome`, `invoiceErrorText` (08 section 8 to a pt-BR hint), `cancelWindowWarning` (FR-130).
* `InvoiceView` gained optional `authorizedAt` and `events`.

### Services (T6.3, T6.7, T6.8)

`packages/http/src/services/invoices/`:

* `issueInvoice` (attendant and admin): locks the order, applies the short form (`fill`: CPF/CNPJ and address parts, written to the customer and, for delivery, to the order), runs V1–V14 through core `buildInvoiceRequest` with the new row id as `reference`, and fills city, UF, and IBGE code from the restaurant (ADR-016). A problem returns `{ outcome: "blocked", problems, missingFields }` and creates nothing. Otherwise it inserts `order_invoices` with the frozen `request_payload` (`on conflict do nothing` against the one-live-invoice index, FR-132), enqueues `issue`, writes an audit row, and emits `invoice.updated`.
* `refreshInvoice`, `getInvoiceFiles` (attendant and admin): the web-nf key is an admin-only secret, so they read the row as the caller, unseal the key under the `system` context, call web-nf with no transaction open, and apply the answer under `system`. `getInvoiceFiles` returns fresh XML and PDF URLs, `authorizedAt`, and the cancel warning. Nothing stores or logs the URLs (FR-138).
* `cancelInvoice` (admin, FR-135): only an `authorized` row with no open request. It sets `cancel_requested_*`, clears the error, enqueues `cancel`, and writes an audit row.
* `applyInvoiceUpdate`: the shared write path (webhook, poll, refresh). It also settles a rejected or failed `cancelamento` event (`cancel_rejected` or `cancel_failed`, request cleared). On every status change it calls P7's `emitEvent(..., "invoice.updated", ...)` (FR-134); on the move to `authorized` it calls `recordUsage(..., "invoice.issued", ...)` (FR-133). The worker's `markFailed` emits too.
* `getOrder` now returns `invoices`, `customerCpfCnpj`, and `codigoMunicipio`. Board cards carry `invoiceStatus` (FR-139).

### Worker (T6.4, T6.6)

`apps/worker/src/handlers/invoice-jobs.ts`, `stores/invoice-store.ts`, registered in `registry.ts`:

* `issue`: skips a row that is gone, not `queued`, or already sent. It checks the frozen payload again (FR-125) and fails with `invalid_payload` without a call. It sends with `Idempotency-Key = order_invoices.id`, stores `external_id` and the status, and queues a poll in 30 s. Timeouts, `5xx`, connection errors, and `429` retry on the framework schedule (FR-137). A refusal fails the row with the 08 text; `validation_failed` stores one pt-BR line per detail. A `401` also marks the integration `error`.
* `poll`: applies `GET /v1/invoices/{id}`. While the status is not final, or an `authorized` row has an open cancel request, it queues the next poll: 30 s, doubling, capped at 10 minutes, at most 40 rounds (`pollRound` in the job). The existing `mt_invoice_poll` cron (0012) covers a row whose chain stopped. A `404` fails the row.
* `cancel`: posts the event with the key `cancel-<id>-<cancel_requested_at ms>` (the same key on a retry) and queues a poll. A refusal records `cancel_<code>` and clears the request.

### Inbound webhook (T6.5)

* `POST /v1/webhooks/web-nf/{restaurant_id}`: `apps/api/src/routes/webhooks/web-nf.ts` over `receiveWebNfWebhook` (`services/invoices/inbound-webhook.ts`). Same seven steps as backend-uatis: 413 cap, secret lookup, `X-NF-Signature` check against a dummy secret for an unknown restaurant (same 401 body for unknown, disconnected, malformed, and bad signature), rate limit, JSON and event parse (422), then apply.
* The row is found by `external_id`, or by `reference` = `order_invoices.id` while `external_id` is still null (a delivery can beat the worker). An unknown invoice answers 200 and writes an audit row. `invoice.*` applies the status idempotently and, when the status moved, queues a poll, because the body carries no error and no `serie`. `event.*` queues a poll and trusts nothing in the body.

### Dashboard (T6.7, T6.8)

* `components/invoice-panel.tsx` in the order detail dialog: status badge, number, series, access key, pt-BR error hint. "Emitir NF" with NFC-e by default and NF-e only when the customer has a CNPJ; "CPF na nota" for a pickup order. A blocked issue lists the problems and opens the short form for the missing fields, prefilled from the order. Live refresh every 5 s while the invoice is in process or a cancel waits. "Ver XML" and "Ver PDF" call `getInvoiceFiles` and open a new tab. "Cancelar NF" (admin only) with a 15-character minimum and the window warning from the server.
* Board cards show a small invoice badge. Server Actions are in `app/(app)/pedidos/invoice-actions.ts`.

### Spec changes, made with the code

* 06: the real web-nf webhook body (no `serie`, no error; `data.event` on `event.*`), the reference fallback, the poll after a status change; Appendix A gains `fill`, the blocked result, and `listOrderInvoices`.
* 08: the status rule, the stored body bytes (jsonb order is stable because every send reads the stored value), poll backoff, error text storage, the connection probe, the cancel response and key, and V1 now also needs a status other than `disconnected`.
* 05: `pollRound` on `mt_invoice_jobs`. 10: the `NF_E2E` steps, the dry run, and the test map row.

### Follow-up fixes (chief review)

* **Same key after an ambiguous failure.** When the issue job exhausts its transport retries, the row becomes `failed` with `error_code = 'ambiguous'` (core `AMBIGUOUS_ERROR_CODE`). "Emitir novamente" then puts that same row back to `queued` and resends the same Idempotency-Key and frozen body (`requeueAmbiguous` in `issue.ts`). Only a definitive outcome creates a new row. Tests: core `isAmbiguousFailure` and the hint text, the worker `onExhausted` test, and two integration tests (same row; new row after `validation_failed`).
* **Automatic connection test.** `saveFiscalConfig` now saves in its own transaction, then runs `testFiscalConnection`, and returns `connected` or `error`. Integration tests updated, plus a refused-key case.
* **Realtime badge.** Migration `0017_realtime_order_invoices.sql` adds `order_invoices` to `supabase_realtime`, guarded like 0013. `authenticated` gets a column-level `select` on the status columns only, plus a member-restaurant policy; `request_payload` stays off the browser path. The board subscribes with `useRealtimeTable("order_invoices", ...)`; the panel poll stays as a fallback. `REALTIME_TABLES` and the new `REALTIME_COLUMN_GRANTS` in `packages/db/src/types.ts`, with tests in `rls.integration.test.ts`. 05 and ADR-017 Amendment 1 record it.

## Verified

* `tsc --noEmit`: core, schemas, http, api, worker, dashboard pass for P6 code. `@mt/http` typecheck currently fails only in P7's `services/public-api/public-api.integration.test.ts` (`IdempotencyStore.save`/`find`), which P7 was changing.
* Unit and API tests, excluding `*.integration.test.ts`: core 403, schemas 112, http 130, db 10, config 1, worker 82, dashboard 45, all pass. api 70 pass, 5 fail; the 5 are P7's idempotency tests (FR-145). The 15 web-nf route tests pass.
* New P6 tests: `invoice-lifecycle.test.ts` (29), `web-nf-gateway.test.ts` (contract plus 17), `invoice-jobs.test.ts` (23), `invoice-store.test.ts`, `web-nf.test.ts` (15), `e2e-nf.dry-run.test.ts` (3), schema and format additions.
* `bun run --cwd apps/dashboard build`: pass.

## Pending

* **Integration tests are written but have not run.** Docker does not answer `docker version` within 10 seconds. Files: `packages/http/src/services/invoices/invoices.integration.test.ts` (18 tests) and `apps/worker/src/invoice-jobs.integration.test.ts` (5 tests). Expect small fixes.
* **T6.10 live smoke has not run.** The web-nf generation API answers on `localhost:3002` (`/v1/health` 200), but every authenticated call hangs past the 10-second timeout, because its database (Docker) is down. There is no `nfk_test_` key. The steps are in 10.testing.md; the dry run passes against `FakeWebNfServer`.
* Some service and store code came before its test: the integration tests could not run first, and `checkFrozenPayload` was written before `invoice-store.test.ts`.

## Risks

* An ambiguous row resent more than 30 days later reaches web-nf after its key expired, so web-nf treats it as a first send.
* Migration 0017 and the column-level Realtime grant have not run (Docker). Realtime is expected to drop columns the role cannot select; this is unverified on the local stack.
* The cancel warning uses web-nf's `authorized_at`. Marmitop stores no authorization time; without web-nf the dialog shows the general NFC-e warning.
* `refreshInvoice` and `getInvoiceFiles` unseal the admin-only key on behalf of an attendant. The key never leaves the server; only the signed URLs reach the browser.
