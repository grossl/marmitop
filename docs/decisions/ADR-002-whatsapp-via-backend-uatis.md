# ADR-002 — WhatsApp channel through backend-uatis

**Status:** accepted · 2026-10-13

## Question

The goal says to use the local `backend-uatis` project for WhatsApp. `backend-uatis` already receives Meta Cloud API webhooks (signature `X-Hub-Signature-256`), stores messages, and sends outbound messages through its dispatcher. How does Marmitop send and receive?

Facts found in `backend-uatis` (2026-10-13):

* `POST /v1/messages` with `Authorization: Bearer obk_live_…|obk_test_…` queues an outbound text. The response is `201` with status `pending`.
* `GET /v1/messages` and `GET /v1/conversations` list stored messages with a cursor.
* Customer webhooks: events `message.created`, `message.updated`, `conversation.updated`. Header `X-Uatis-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "t.body")>`.
* **Risk:** the `backend-uatis` worker does not deliver customer webhooks yet (`apps/worker/src/index.ts` is inert).

## Options

1. **Call the Meta Cloud API from Marmitop directly.** This duplicates `backend-uatis` and goes against the goal.
2. **Use `backend-uatis` and receive only its webhooks.** Inbound messages do not arrive until `backend-uatis` delivers webhooks.
3. **Use `backend-uatis`, receive its webhooks, and also poll `GET /v1/messages` as a reconciliation job.**

## Tradeoffs

Option 2 is the cleanest design but depends on work outside this repository. Option 3 adds a poll job. The poll is idempotent because every message carries the `backend-uatis` message id. It works today and stays useful later as a safety net for lost webhooks.

## Recommendation and choice

Option 3.

* A port `WhatsAppGateway` in `packages/core` has two adapters: `UatisGateway` (HTTP) and `FakeGateway` (tests and local development).
* Each restaurant stores its `backend-uatis` base URL, API key (encrypted, ADR-012), webhook secret (encrypted), and `phone_number_id`. Settings → WhatsApp is where the admin enters these values.
* **Outbound:** the dashboard inserts a `messages` row with status `pending` and enqueues a job. The worker calls `POST /v1/messages` and stores the returned id as `external_id`.
* **Inbound:** `apps/api` exposes `POST /v1/webhooks/uatis/{restaurant_id}`. It verifies `X-Uatis-Signature` with a constant-time compare and a 5-minute timestamp tolerance, then upserts by `external_id`.
* **Reconciliation:** pg_cron enqueues a poll every 30 seconds for each connected restaurant. The worker reads `GET /v1/messages` after the last stored cursor and upserts.
* **Delivery and read status:** `message.updated` events and the poll update `messages.status`.
* In development, a "Simulate customer message" control (dashboard, dev only) injects inbound messages through `FakeGateway`. This control is how the definition-of-done flow runs without a real number.

## Consequences

* Marmitop never holds Meta credentials. The goal's "inbound webhook with signature verification" is met by verifying the `backend-uatis` signature. `backend-uatis` verifies the Meta signature.
* Tests cover `X-Uatis-Signature` verification (valid, tampered body, stale timestamp, wrong secret).
* Open item outside this repo: wire customer webhook delivery in the `backend-uatis` worker.
