# ADR-023 — One backend-uatis event log, read by push or pull

**Status:** accepted · 2026-10-14 · amends ADR-002 and ADR-021

## Question

Marmitop must receive WhatsApp messages and status updates from `backend-uatis` in local development and in deployment, and the process must stay secure. ADR-021 uses push webhooks. Push needs a public HTTPS URL on port 443, and `backend-uatis` refuses private and loopback targets with no override. A developer machine has no public URL. The current fallback poll (`GET /v1/messages?direction=in&from=<timestamp>`) sees inbound messages only, misses status updates, and relies on a 60-second overlap because `backend-uatis` has no change cursor. How does Marmitop receive events in both environments?

## Options

1. **Tunnel** (cloudflared, ngrok) from the internet to the developer machine. Exposes a local API to the internet, adds a third party to the trust chain, and the URL changes on every run.
2. **Relax the `backend-uatis` SSRF guard** in development so its worker posts to `http://localhost`. Weakens a security control, and a shared `backend-uatis` database would make deployed workers try local targets.
3. **Keep the timestamp poll.** No status updates, overlap guesswork, and no exact resume after downtime.
4. **One event log, two readers.** `backend-uatis` already writes one `webhook_deliveries` row per subscribed event. Expose that log as a cursor-paginated feed per webhook. A webhook is either `push` (the worker also POSTs it, signed) or `pull` (no URL; the client reads the feed).

## Tradeoffs

Option 4 needs changes in `backend-uatis`: a `mode` column, a feed endpoint, a cursor, and a retention rule. In return:

* Local development needs no inbound connection at all. Marmitop only makes outbound HTTPS calls with its API key, which is the same trust path it already uses to send messages.
* Push and pull deliver the same envelope, so Marmitop has one ingest path.
* After downtime, a push client pulls the gap from its last cursor. Nothing is lost and nothing is guessed.
* Status updates (`message.updated`) arrive in both modes.

## Recommendation and choice

Option 4.

### Contract (backend-uatis)

* `POST /v1/webhooks` accepts `mode: "push" | "pull"` (default `push`). `pull` takes no `url` and returns no signing secret. `push` behaves as today.
* `GET /v1/webhooks/{id}/events?after=<cursor>&limit=<1..100, default 50>` with `Authorization: Bearer obk_*`. It answers `200 { data: [Event], next_cursor: string | null }` in ascending order. `Event = { cursor, id, type, created_at, organization_id, data }`, where `id` is the delivery id and `type`, `organization_id`, and `data` match the push body byte for byte.
* The cursor is opaque. It encodes `(created_at, id)`. The feed returns only rows older than 2 seconds (a settle window), so a transaction that commits late cannot be skipped.
* Rows stay readable for 7 days. An `after` older than retention answers `410 cursor_expired`.
* Authorization is the same as webhook management. A foreign webhook id answers `404`.
* The push worker ignores `pull` webhooks.

### Marmitop

* **Mode selection.** If `MT_PUBLIC_URL` is a public `https` URL on port 443, "Ativar webhook" registers `push` and Marmitop also pulls the feed every 5 minutes for recovery. Otherwise it registers `pull` and reads the feed every 3 seconds (`MT_UATIS_PULL_SECONDS`, default 3). Local development therefore needs no tunnel.
* **One ingest path.** Webhook bodies (after signature, timestamp, and `organization_id` checks) and feed events go through the same handler. Events are deduplicated by event `id`, and messages by `external_id`, so a push and a pull of the same event are harmless.
* **Cursor.** `integrations_whatsapp.uatis_feed_cursor` stores the last processed cursor. It advances only after the batch commits. `410 cursor_expired` resets it to null and logs a warning.
* **Old feed.** If the feed endpoint answers 404 (an older `backend-uatis`), Marmitop falls back to the timestamp poll from ADR-002.

### Security rules

1. Per restaurant, a dedicated `backend-uatis` API key with the smallest role that can manage webhooks. It is stored encrypted (ADR-012) and never sent to the browser.
2. In production, `backend-uatis` base URLs must be `https` (the SSRF guard already blocks private hosts; `MT_ALLOW_PRIVATE_HOSTS` stays development-only).
3. Push requests: HMAC signature, 5-minute timestamp tolerance, `organization_id` must match, deduplication by `X-Uatis-Delivery` and event id, per-restaurant rate limit, 256 KB body cap.
4. No tunnel and no relaxed SSRF guard anywhere.
5. Registering again replaces the webhook and rotates the push secret.

## Consequences

* `backend-uatis` gets its own ADR and migration for `webhooks.mode`, the nullable `url`, the feed endpoint, and retention.
* Changes to `backend-uatis` are made on a branch and are never pushed by Marmitop work, because its CI deploys on push.
