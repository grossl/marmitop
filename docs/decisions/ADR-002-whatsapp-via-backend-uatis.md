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

## Amendment 1 — 2026-10-13 (facts found while writing 06.api-spec.md)

* **The poll is required, not a safety net.** The `backend-uatis` worker does not deliver webhooks today, so the reconciliation poll is the only working inbound path.
* **Poll cursor.** The `backend-uatis` cursor is opaque and does not mean "after message X". The poll reads `GET /v1/messages?direction=in&from=<timestamp>` and stores the newest `created_at` it saw in `integrations_whatsapp.last_sync_cursor`. It overlaps by 60 seconds and relies on the `external_id` upsert for deduplication.
* **Status mapping.** `backend-uatis` returns `status: {state}`. Marmitop maps `pending|sent|delivered|read|failed` one to one and stores inbound `received` as `delivered`.
* **Payload.** The inbound text is at `data.message.content.text.body`. v1 stores text only. Other content types get the body `[mídia não suportada]`. Outbound calls send `from_address = phone_number_id`.
* **24-hour window.** See ADR-014.

## Amendment 2 — 2026-10-14 (facts found while building UatisGateway, P5)

* **Text shape.** backend-uatis stores and returns text as `content: { version: "1", type: "text", kind: "text", text: "<string>" }` (`packages/http/src/services/send.ts` `outgoingContent`, the Meta ingest). Its 06.api-spec.md shows `text: { body }`. `mapUatisMessage` reads both. Empty text counts as unsupported media.
* **Internal rows.** `GET /v1/messages` can return `direction: "internal"` (agent tool traffic). The gateway skips them (`tryMapUatisMessage`).
* **Order and cursor.** The list is newest first with a keyset cursor. The poll walks every page (cap 20 pages of 100), then applies oldest first.
* **Connection test.** `testConnection` is `GET /v1/messages?limit=1`: one authenticated read. `GET /v1/health` needs no key, so it proves nothing.
* **Outbound echoes.** A `message.created` with `direction: "out"` and an unknown id is ignored. The id of a Marmitop send is stored only after `POST /v1/messages` returns, so the echo can arrive first.
* **Webhook for an unknown restaurant.** It answers the same `401` as a bad signature (FR-118 updated), so the route is not an oracle for restaurant ids.

## Amendment 3 — 2026-10-14 (backend-uatis delivers webhooks)

* backend-uatis commit `c887ef0` (its ADR-009) delivers customer webhooks. [ADR-021](ADR-021-uatis-webhook-registration.md) registers them from Settings, and [ADR-023](ADR-023-uatis-event-feed-push-and-pull.md) adds the event feed: a `push` webhook when `MT_PUBLIC_URL` is public, a `pull` webhook read every 3 seconds otherwise. A restaurant with a registered webhook reads the feed instead of the timestamp poll. The timestamp poll from Amendment 1 stays for restaurants without a webhook and as the fallback when the feed answers 404.

## Amendment 4 — 2026-11-06 (backend-uatis documents shared locations)

* backend-uatis commit `823eac5` documents the location content (its 06.api-spec.md "Location messages"): `content: { version: "1", type: "data", kind: "location", data: { latitude, longitude, name?, address?, url? } }`. Webhook events and `GET /v1/messages` carry the same content.
* `latitude` and `longitude` are always present. `name` and `address` are present only when the customer picks a place on the map. A "current location" share has coordinates only.
* Marmitop stores a location as text, so the dashboard, the AI history, and the attendant read it without a new column. The body is two lines: `📍 <name> - <address>` (the parts that are present, or `📍 Localização` when neither is), then `https://www.google.com/maps?q=<latitude>,<longitude>`.
* A location without finite coordinates, and WhatsApp live location (`kind: "unsupported"`), stay `[mídia não suportada]`.
