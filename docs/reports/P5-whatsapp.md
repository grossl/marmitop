# P5 report: WhatsApp channel

## Done

### Adapter (T5.2)

`UatisGateway` lives in `packages/http/src/adapters/` (no new package; 04.architecture.md records the choice).

* `safe-fetch.ts`: the only HTTP client for admin-entered URLs. It uses `node:http` and `node:https` with a `lookup` hook. The hook resolves the name, refuses the request when any address is private, and hands the checked address to the socket. No second DNS answer is used. It has a 10-second timeout, follows no redirect, and caps the response at 1 MiB. `MT_ALLOW_PRIVATE_HOSTS=1` allows `http:` and private hosts. `readServerConfig` refuses that flag when `MT_ENV=production`.
* `uatis-gateway.ts`: `sendText`, `sendTemplate`, `listMessages`, `listApprovedTemplates`, `testConnection` (`GET /v1/messages?limit=1`). It throws `GatewayError`. Core gained two failure kinds: `network_error` (the connection broke after the request may have left) and `refused` (the SSRF guard stopped the request before it left).
* Error classes for a send: `422 outside_service_window` and `whatsapp_disconnected` are permanent. A timeout, a `5xx`, a broken socket, or an unreadable `2xx` is ambiguous, with no retry. A connection error before the request left, or a `429`, is transient.
* The adapter passes the `@mt/core/contracts` WhatsAppGateway suite against `FakeUatisServer`, a `Bun.serve` stand-in that returns the shapes backend-uatis really returns.
* `createServiceDeps` returns `UatisGateway` unless `MT_UATIS_FAKE=1`. The worker loads each restaurant's base URL, `phone_number_id`, and unsealed API key from `integrations_whatsapp` and `secrets`.

### Worker (T5.3, T5.5, T5.6)

* The framework is in `apps/worker/src/framework/`: `HandlerRegistry` (keyed by queue and `payload.op`), `QueueWorker` (one poll loop per queue, batches, a shared concurrency semaphore, the visibility timeout, retries at 1m/5m/30m/2h/8h, one `job_attempts` row per attempt, archive on success and on final failure, graceful stop), and `PgmqQueueClient`. A retried job carries `attempt`. `GET /health` on 8181 returns 200 while the worker runs and 503 while it stops.
* `handlers/outbound-message.ts` (`mt_outbound_messages`): sends text, or the template when the row has one. Before the call it claims the row (`messages.send_claimed_at`, migration 0015) in a committed transaction. A claimed row is never sent again. Only a connection error before the request left releases the claim and retries.
* `handlers/whatsapp-reconcile.ts` (`mt_sync` `whatsapp_reconcile`): reads from `last_sync_cursor − 60 s` (or the last 24 hours on the first poll), walks every page, applies messages oldest first through `applyGatewayMessage`, and then advances the cursor. A refused key sets the integration to `error`.
* The Postgres stores are in `apps/worker/src/stores/`.

### Inbound webhook (T5.4)

* `POST /v1/webhooks/uatis/{restaurant_id}` is in `apps/api/src/routes/webhooks/uatis.ts`, and the logic is `receiveUatisWebhook` in `packages/http/src/services/whatsapp/inbound-webhook.ts`.
* Order: 256 KB cap (413), secret lookup, then the signature check (5-minute tolerance, constant-time compare, more than one `v1` accepted). An unknown restaurant, a malformed id, a disconnected integration, a wrong secret, and a tampered body all get the same `401` body. An unknown restaurant still runs the HMAC against a dummy secret. After a valid signature come the rate limit (300 per minute per restaurant, `rate_counters`), the JSON and event parse (422), and the apply step.
* `message.created` and `message.updated` upsert by `external_id`, and the status only moves forward. A replay changes nothing.

### Automatic messages (T5.7, T5.9)

* `services/whatsapp/automatic.ts`: `runInboundAutomation` covers welcome and closed (12-hour rule, `closed_notice_sent_at`, row lock). `enqueueOrderReceived` sends text inside the window and the template outside it. Without a template it stores a `failed` row with `outside_service_window` and no job. Rows have `sent_by = null` and `automatic_kind` set, and they are enqueued in the same transaction.
* The webhook, the poll, and `simulateInboundMessage` all run the inbound automation. `createOrder` calls `enqueueOrderReceived`. Both `// P5:` markers are gone.
* `retryMessage` clears the claim and lets a template message be retried outside the window.
* `ingestInboundMessage` now moves `last_message_at` and `last_inbound_at` forward only, so an older message from the poll does not rewind them.

### Spec changes, made before the code

* FR-118, 06, 07, 10: an unknown or disconnected restaurant gets the same `401` as a bad signature, not a `404`. Otherwise the route reveals which restaurant ids exist.
* ADR-002 Amendment 2: backend-uatis stores text as `content.text` (a string), not `content.text.body`. The mapper reads both. Rows with `direction: "internal"` are skipped. An unknown outbound echo is ignored because it can arrive before the worker stores the id.
* 05 and migration 0015: `messages.template_language` and `messages.send_claimed_at`.
* 04: adapter location, the worker framework, the api layout, and the error kinds. 07: SSRF step 3 is implemented, and the rate limit counts only signed requests. 10: test paths and the `UATIS_E2E` steps.

## Verified

* `bun run typecheck`: 9 of 9 tasks pass.
* Unit and API tests, excluding `*.integration.test.ts`: core 374, schemas 110, http 74, db 10, config 1, api 22, worker 43. All pass.
* `bun run --cwd apps/dashboard build`: pass.
* The `UATIS_E2E` script ran end to end against `FakeUatisServer`: 5 of 5 steps pass.

## Pending

* **Integration tests are written but have not run.** Docker does not answer `docker version` within 10 seconds. The files are `packages/http/src/services/whatsapp/whatsapp.integration.test.ts` (21 tests) and `apps/worker/src/worker.integration.test.ts` (9 tests). Migration 0015 has not been applied. One existing test changed: `admin/integrations.integration.test.ts` now sets `allowPrivateHosts: false` for its production case. To run them: restart Docker, run `bun run dev:stack`, then run `bun test` in `packages/http` and `apps/worker`. Expect small fixes.
* **T5.11 live smoke has not run.** Something answers on `localhost:3001` (401 without a key), but there is no `obk_test_` key. The steps are in 10.testing.md.
* backend-uatis still does not deliver webhooks (ADR-002). The poll is the working inbound path.
* The poll reads inbound messages only. Outbound `delivered` and `read` states arrive only by webhook, so the ticks stay at `sent` until backend-uatis delivers webhooks.
* P7 markers remain: `message.received` and `order.created` events, and `usage_events` for `message.sent`.
* Not checked in P5: the Settings template picker (FR-084, `listApprovedTemplates`) and the messages-screen UI from T5.8.

## Risks

* The `mt.reap_stuck_messages` cron marks a message that stays `pending` for more than 10 minutes as `failed` / `stuck`. A send that keeps getting connection errors therefore stops after the 1-minute and 5-minute retries. The 30m, 2h, and 8h retries skip it because it is no longer `pending`. This is safe: there is no double send. But the full backoff applies only to the poll.
* The poll reads at most 20 pages of 100 messages per run, newest first. If more messages arrive in one window, the oldest are skipped and a warning is logged.
* If the worker crashes between the claim and the send, the message ends `failed` / `ambiguous` even though nothing left. The attendant resends it by hand. This is the cost of at-most-once.
* The DNS-pinning `lookup` hook relies on how Bun's `node:http` behaves. A test proves Bun calls the hook, but there is no test with real TLS and SNI.
