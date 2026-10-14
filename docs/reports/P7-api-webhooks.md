# P7 report: public API, outbound webhooks, usage metering

## Done

### API-key chain (T7.1, T7.3)

* `authenticateApiKey` is in `packages/http/src/services/public-api/api-keys.ts`. It reads `Authorization: Bearer mtk_(live|test)_<32 base62>`. Any other format gets `401` before any database work. It hashes the key and calls `mt.api_key_lookup`. No row and a revoked row get the same `401` body. The context is actor `api_key`, role `attendant`. It then calls `mt.touch_api_key`; a failed touch does not refuse the request.
* The chain is in `apps/api/src/routes/public/middleware.ts`: API key, rate limit, idempotency, route. Health and the inbound webhooks do not pass through it.
* Rate limit: 600 reads and 120 writes per minute per key, in `rate_counters` through the P5 `hitRateCounter` (it now also returns `count`). Every answer carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`. Over the limit: `429 rate_limited` with `Retry-After`.
* Idempotency (`POST` only), atomic: the key is claimed first in its own transaction (`insert ... status 'in_progress' on conflict do nothing`, migration `0016_idempotency_claim.sql`). Completed with the same hash: replay with `Idempotency-Replayed: true`. Another hash: `409 idempotency_conflict`. In progress with the same hash: `409 idempotency_in_progress` with `Retry-After: 1`. A claim older than 60 s is taken over. A `2xx` stores the response and completes the row; any other answer or an error deletes the claim. A key that is empty or over 255 characters gets `422`. New error code `idempotency_in_progress` (409) in core.
* Errors: one envelope, `details` always present (`[]` when empty). Service paths in camelCase leave as snake_case body paths (`items[0].menu_item_id`). An unexpected error is `500 internal_error`; its message is logged, never sent. No log line holds the API key.
* 05 defines no `api_logs` table, so none was added.

### Public routes (T7.2)

`apps/api/src/routes/public/{orders,customers,menu,messages}.ts`, over services in `packages/http/src/services/public-api/`:

* Orders: list (keyset cursor on `created_at desc, id desc`; filters `status`, `source`, `customer_id`, `from`, `to`, `q`), get by uuid or code with `status_history`, create, `PATCH` status. Create runs `createOrderInTx`, now shared with the dashboard `createOrder`: same totals, address rules, automatic message, usage, and event. It sets `source = 'api'` and `created_by_api_key`. `PATCH` runs `changeOrderStatusInTx`.
* Customers: list, get, create, update. Writes run `createCustomerInTx` and `updateCustomerInTx` from `services/messaging/customers.ts`. A duplicate phone is `409 conflict` (detail code `duplicate_phone`; the dashboard still shows it on the phone field).
* Menu: list, read only, archived items hidden, no `ncm` or `cfop`.
* Messages: `POST` runs `sendMessageInTx`. A customer with no conversation has never written, so the answer is `422 outside_service_window` and nothing is stored.
* A path id that is not a uuid (customers) or not a uuid or code (orders) is `404`, like a foreign id.
* `createPublicApiBackend(deps)` bundles the key directory, the rate limiter, the idempotency store, and the operations. `ApiDeps.publicApi` is optional, so P5 and P6 tests that build the app without it still pass.

### Outbound webhooks (T7.4, T7.5)

* `emitEvent(tx, restaurantId, type, data, options?)` in `packages/http/src/services/webhooks/emit.ts`. For an enabled endpoint that subscribes to `type`, it inserts a `pending` delivery (`next_attempt_at = now`, the 06 envelope as payload) and enqueues `mt_webhook_deliveries`, in the caller's transaction. The id is generated in code because attendants and API keys may insert deliveries but not read them.
* Emitters: `createOrderInTx` (`order.created`, data `{ order: <Order object> }`), `changeOrderStatusInTx` (`order.status_changed`, only when the status changed), `ingestInboundMessage` (`message.received`, once per stored message: webhook, poll, and dev simulation). The `// P7` markers are gone. `invoice.updated` is for P6.
* Sender: `SafeFetchWebhookSender` (`packages/http/src/adapters/webhook-sender.ts`) signs the stored body with `buildOutboundWebhookHeaders`, adds `User-Agent: Marmitop-Webhooks/1`, and posts through `safeFetch` (SSRF guard, 10 s, no redirects). It passes the core `webhookSenderContract`.
* Handler: `apps/worker/src/handlers/webhook-delivery.ts`, registered in `apps/worker/src/registry.ts`, store `apps/worker/src/stores/webhook-delivery-store.ts`. `2xx`: delivered. Any other status, a timeout, or a network error: `failed` with `next_attempt_at` at 1 m, 5 m, 30 m, 2 h, 8 h, then `exhausted`. A host the SSRF guard refuses, or a disabled endpoint: `exhausted` at once. The attempt number comes from the row, so a job re-enqueued by the sweep keeps the schedule. Each attempt updates the row; the framework writes `job_attempts`. `last_error` is an allow-listed code (`http_500`, `timeout`).
* Settings: the webhook section shows the 50 newest deliveries (event, status, attempts, last status code or error, time) and a **Reenviar** button for delivered or exhausted ones. Services `listWebhookDeliveries` and `redeliverWebhook` (admin), action `redeliverWebhookAction`. Redeliver keeps the id and body and starts the attempts over; a pending or failed delivery is `409`.

### Usage metering (T7.6)

* `recordUsage(tx, restaurantId, kind, refId, occurredAt?)` in `packages/http/src/services/billing/usage.ts`. `on conflict (kind, ref_id) do nothing`.
* `order.created`: in `createOrderInTx`. `message.sent`: in `DbOutboundStore.markSent`, in the same transaction that stores the external id. `invoice.issued`: P6 calls `recordUsage`.

### Spec changes

* 06: `details` always present; idempotency stores `2xx` only and refuses a bad key; rate-limit headers on every answer; `whatsapp_not_configured` is a worker failure, not a `422`, because an API key cannot read `integrations_whatsapp`; webhook `User-Agent`, retry and exhaust rules, `emitEvent`; Appendix A adds `listWebhookDeliveries` and `redeliverWebhook`.
* 06.openapi.yaml: `429` on the two get-by-id routes, `422` on lists, menu `q`, `Idempotency-Replayed` on customer and message creates, non-uuid path ids, webhook rules. `apps/api/src/openapi.contract.test.ts` checks that the spec and the app list the same routes, and that every API-key operation documents `401` and `429` and every `POST` documents `Idempotency-Key`.
* 07: the webhook response cap is the `safeFetch` 1 MiB, not 1 KB; implementation pointers.

## Verified

* `bun run typecheck`: 9 of 9 tasks pass.
* Unit and API tests, without `*.integration.test.ts`: core 403, schemas 112, http 129, db 10, api 75, worker 82, dashboard 45. All pass. P7 adds: http 30 (cursor, wire, api-keys, idempotency, rate-limit, emit, webhook-sender with the contract suite), api 38 (36 route tests over every public route, 2 contract tests), worker 11, dashboard 2.
* `bun run --cwd apps/dashboard build`: pass.

## Pending

* **Integration tests are written but have not run.** `docker version` does not answer within 10 seconds. Files: `packages/http/src/services/webhooks/webhooks.integration.test.ts`, `packages/http/src/services/public-api/public-api.integration.test.ts` (includes concurrent claims of one key), `apps/worker/src/webhook-delivery.integration.test.ts`. To run: restart Docker, `bun run dev:stack`, then `bun test` in `packages/http` and `apps/worker`. Expect small fixes.
* The settings delivery list was not checked in a browser (no database).
* 06 says the key's `environment` is recorded in `audit_logs`. The API does not write a per-request audit row yet. The environment is on the context (`AuthenticatedApiKey.environment`) for that work.
* No end-to-end run of the api process against a real database.

## Risks

* If storing a `2xx` response fails, the claim stays `in_progress` and is taken over after 60 s, so a retry after that runs the request again.
* Migration 0016 has not been applied (no database). It is additive: a column with a default, two nullable columns, two checks.
* Existing dashboard flows now write a webhook delivery and a pgmq job when the restaurant has an enabled endpoint. The seed has one subscribed to `order.created`, so older integration tests that count rows in `mt_webhook_deliveries` or `usage_events` may need an update.
* `message.received` reads the customer row once more per inbound message. The cost is one indexed select.
* `biome format` ran over `apps/api/src` and `apps/worker/src` while P6 worked there. It changes whitespace only.
