# P10 report: backend-uatis webhooks and the event feed

Specs: ADR-021 (registration), ADR-023 (push or pull over one event log, amends ADR-021 and ADR-002), FR-170 to FR-179.

## Done

### Spec first

* ADR-002 Amendment 3 points at ADR-021 and ADR-023. ADR-021's status line says ADR-023 amends it. `decisions/README.md` has rows for 021 and 023.
* 02.requirements.md: FR-170 to FR-179 (FR-100 to FR-119 are full; the section says so). FR-085 makes the webhook secret optional. FR-107 limits the 30-second poll to restaurants without a webhook.
* 05.data-model.md: the new `integrations_whatsapp` columns, `uatis_event_receipts`, the role row, the cron rows, and migration 0019.
* 06.api-spec.md: the exact push body and headers from backend-uatis `body.ts` and `deliver.ts`, the organization check, the receipt dedupe, the event feed, and Appendix A rows for `enableUatisWebhook`, `disableUatisWebhook`, `getUatisWebhookStatus`. 06.openapi.yaml: the real message shape.
* 07.security.md, 04.architecture.md, 10.testing.md, 11.operations.md: `MT_PUBLIC_URL` rules, `MT_UATIS_PULL_SECONDS`, pull mode for local development (no tunnel), the runbook, and the late-commit risk.

### Migration 0019 (`supabase/migrations/0019_uatis_webhook_registration.sql`)

* `integrations_whatsapp`: `uatis_webhook_id`, `uatis_webhook_mode` (`push` | `pull`, null exactly when there is no webhook, checked), `uatis_organization_id`, `uatis_feed_cursor` (at most 1024 characters), `last_webhook_at`, `last_polled_at`. `webhook_secret_id` is now nullable.
* `uatis_event_receipts (restaurant_id, event_id)`: tenant policies, admin read, insert, and delete. Trimmed after 8 days (`mt.trim_uatis_event_receipts`, pg_cron `55 3 * * *`).
* `mt.enqueue_whatsapp_sync`: skips push webhooks; runs the timestamp poll every 10 minutes for pull webhooks (the safety net for backend-uatis commits that land behind the feed cursor).
* `mt.enqueue_uatis_feed_pulls(pull_seconds)`: granted to `app_service`; the worker calls it on a timer.
* Types: `IntegrationWhatsappRow`, `UatisEventReceiptRow`, `TENANT_TABLES`. The test fixture seeds one receipt; the RLS suite covers the new table.

### Gateway

* Port `WhatsAppGateway`: `getOrganization`, `createWebhook` (push or pull), `getWebhook`, `deleteWebhook` (404 is `{ deleted: false }`), `listWebhookDeliveries`, `listWebhookEvents`.
* `UatisGateway` calls `GET /v1/organizations/current`, `POST /v1/webhooks` (pull sends no `url`), `GET` and `DELETE /v1/webhooks/{id}`, `/deliveries`, and `/events`. A push answer without a secret counts as unreadable.
* `FakeGateway` and `FakeUatisServer` implement the final contract: `next_cursor` is the last event's cursor and echoes `after` when nothing is new; `410`, `400` on a foreign cursor, `404`, and `403` for a `member` key. Every inbound inject, send, and status change writes one event per subscribed webhook. `uatisWebhookBody` renders the exact push body. The contract suite runs against both.

### One handler for push and pull

* `applyUatisEvent` (`packages/http/src/services/whatsapp/uatis-events.ts`) records the event id in `uatis_event_receipts` and stops on a repeat, then runs `applyGatewayMessage`. The receipt and the rows commit together.
* `receiveUatisWebhook`: signature, rate limit, JSON, then `organization_id` against `uatis_organization_id` (same 401; skipped when the column is null), then the event, then `accept` (the handler plus `last_webhook_at`) in one transaction. The event id is the body `id`, else `X-Uatis-Delivery`.
* `parseUatisWebhookEvent` returns `organizationId`, ignores `internal` rows, and maps `failed` errors to `whatsapp_<code>` and the title. `applyStatusUpdate` stores them.

### Services (admin)

* `enableUatisWebhook`: push when `MT_PUBLIC_URL` passes `checkPublicBaseUrl` (https, port 443, no credentials, query, or fragment, no private host; `MT_ALLOW_PRIVATE_HOSTS` does not relax it), pull otherwise. Reads the organization, deletes the old webhook, creates the new one, seals the push secret and deletes the old secret row, stores the ids, clears the cursor, and audits (`webhook_id`, `mode`, `last4`). A refused create clears the webhook columns and returns pt-BR text; `403` gives "A chave da API do Uatis precisa ser de administrador.".
* `disableUatisWebhook`, `getUatisWebhookStatus` (never throws on a gateway failure).
* `connectWhatsApp` accepts no webhook secret. `MT_PUBLIC_URL` and `MT_UATIS_PULL_SECONDS` are read by `readServerConfig` and carried in `ServiceDeps.publicUrl`.

### Worker

* `uatis_feed_pull` handler (`apps/worker/src/handlers/uatis-feed.ts`) and `DbFeedStore`. One transaction per event with its cursor. A short page ends the run. `410` and a `400` on the cursor reset it. `404`: `GET /v1/webhooks/{id}` decides between "no feed here" (timestamp poll) and "webhook gone" (clear it, then the timestamp poll). `403` sets the integration error. A malformed event or one from another organization is skipped and the cursor moves on.
* `runTimestampPoll` and `gatewayFailure` are shared with `whatsapp_reconcile`.
* `FeedPullTimer` calls `mt.enqueue_uatis_feed_pulls(MT_UATIS_PULL_SECONDS)` every `MT_UATIS_PULL_SECONDS`.

### Dashboard

* Settings → WhatsApp: a "Webhook do backend-uatis" panel with "Ativo" or "Não registrado", a "Push" or "Pull" badge with a pt-BR explanation, the last push and the last read, the mode the next activation will pick and why, the last five backend-uatis attempts or a note, and "Ativar webhook" (or "Registrar novamente") and "Desativar webhook". "Segredo do webhook (opcional)".
* Text helpers in `admin-format.ts`, with unit tests.

## Verified

* `bun run typecheck`: 9 of 9.
* Unit, API, and integration tests, run per package against the local stack: core 442, schemas 113, db 272, api 87, worker 122, dashboard 74, all pass. `packages/http`: 386 pass, 8 fail. The same 8 fail on a clean worktree of HEAD (`903d6c6`) against a separate database, so P10 did not cause them: stock (2), messaging (3), public-api (1), `rotateWebhookSecret` (1), and the whatsapp test "restaurant B's integration row with A's secret" (1; it answers 500 because the fixture's secret cannot be opened by the test SecretBox).
* `bun run db:reset`: migration 0019 applies; seed verification passes (it now expects 11 pg_cron jobs).
* Replay: `UATIS_E2E=1 ... bun apps/worker/e2e-uatis/replay-webhook.ts` against the local api with the exact backend-uatis body and headers gave `[200, 200, 401]`, and with `uatis_organization_id` set `[200, 200, 401, 401]`. Both messages appear in Mensagens for `+5511988776655`, with the "closed" automatic reply. Two receipts (`push`) and `last_webhook_at` were stored. The test organization id was cleared afterwards.
* Browser: Settings → WhatsApp shows the panel ("Não registrado", "Ao ativar, o modo será Pull: ..."), and with a webhook row set by hand, "Ativo · Push", the push explanation, and the deliveries note.
* The running worker logged "uatis webhook no longer exists at backend-uatis; cleared, timestamp poll instead" for a webhook id its fake did not know: the timer, the job, and the 404 path work in the live stack.

## Pending and needs from the user

* **Restart the dashboard dev server.** The running process caches `ServiceDeps` on `globalThis` from before this change. Its `FakeGateway` instance predates the new methods (so "Ativar webhook" there fails with a TypeError, logged as `settings.enableUatisWebhook`), and its config has no `publicUrl` (so the panel says `MT_PUBLIC_URL` is not set). A restart fixes both. I did not stop it, as asked.
* **Live check against backend-uatis.** backend-uatis answers on `localhost:3001` (`/health` 200, `/v1/webhooks` 401 without a key). I created no key and changed nothing there. To run it: an `obk_test_` key with role `admin`, `MT_UATIS_FAKE` unset in the dashboard and the worker, then "Ativar webhook" (pull locally).
* With `MT_UATIS_FAKE=1`, the dashboard and the worker hold separate fakes, so the worker clears a webhook the dashboard registered (documented in 11.operations.md).

## Risks

* A backend-uatis transaction longer than its 2-second settle window can commit behind the feed cursor. Push covers it. In pull mode the 10-minute timestamp poll recovers inbound messages, but a late status update is lost until the next one.
* Gateway calls run inside the admin service's transaction (the existing pattern), so a slow backend-uatis holds a row lock for up to the 10-second timeout per call.
* `enableUatisWebhook` deletes the old webhook before it creates the new one, as the spec says. If the create fails, there is no webhook until the admin retries; the 30-second poll covers the gap.
* `MT_PUBLIC_URL` is checked as text. A public name that resolves to a private address selects push, and backend-uatis then records `ssrf_blocked`; Settings shows it in the attempts.
* The feed timer runs in every worker process. The SQL function never enqueues a second job while one waits, so extra workers cost queries, not duplicates.
