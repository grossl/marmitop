# ADR-042 — Webhook only, with a manual refresh

**Status:** accepted · 2026-11-11 · supersedes the pull mode and the event feed of ADR-023, and the feed timer of ADR-041; amends ADR-002 Amendment 1

## Question

Marmitop reads `backend-uatis` in three ways besides the push webhook. pg_cron polls `GET /v1/messages` every 30 seconds for a restaurant without a webhook. The worker reads the event feed every 3 seconds in pull mode. It also reads the feed every 5 minutes in push mode, to recover lost pushes. The owner wants only the webhook: "lets remove the service that consult each time, let keep only the webhook to do the conection". How does local work get events, and what recovers an event that `backend-uatis` gives up on?

## Options

1. **Keep the 5-minute recovery read.** Lost pushes come back alone. One periodic call per restaurant stays, which the owner does not want.
2. **Webhook only, no recovery.** A push that `backend-uatis` gives up on is lost until someone redelivers it in `backend-uatis`.
3. **Webhook only, and a manual refresh.** No timer reads `backend-uatis`. An "Atualizar" button on the Conversas page enqueues one timestamp poll, only when a person presses it.

For local work, the options are a tunnel, or a push to a private `http` URL when `MT_ALLOW_PRIVATE_HOSTS=1`.

## Tradeoffs

Option 3 keeps the owner's rule: Marmitop calls `backend-uatis` on a schedule never. It reuses the tested timestamp poll (`runTimestampPoll`), so no new read path is needed. The poll reads inbound messages only. A lost `message.updated` (delivered, read) is not recovered; the status stays at the last value Marmitop saw.

A restaurant with no webhook now gets no inbound message without a press of "Atualizar". Settings → WhatsApp says so.

Push to a private `http` URL in development needs no tunnel, and `MT_ALLOW_PRIVATE_HOSTS` is already refused in production (ADR-017 #5). `backend-uatis` must accept that URL in its own development setup; that change belongs to the `backend-uatis` repository.

## Choice

Option 3, and push to a private URL in development.

* **One mode.** "Ativar webhook" registers `mode: push` only. In production the URL must pass FR-172. With `MT_ALLOW_PRIVATE_HOSTS=1` (refused in production), `http`, any port, and a private or loopback host are also allowed. Any other URL returns a pt-BR error and calls nothing.
* **No periodic read.** Migration 0033 unschedules `mt_whatsapp_reconcile`, drops `mt.enqueue_whatsapp_sync()` and `mt.enqueue_uatis_feed_pulls(integer)`, drops `integrations_whatsapp.uatis_feed_cursor`, and clears every pull webhook (they show "Não registrado"). The worker loses the feed timer and the `uatis_feed_pull` job. `MT_UATIS_PULL_SECONDS` is gone.
* **Manual refresh.** `refreshWhatsApp` (any member) calls `mt.request_whatsapp_refresh()`. That function reads the restaurant from the RLS context, so it never enqueues for another restaurant. It enqueues one `mt_sync` `whatsapp_reconcile` job unless one already waits. The worker runs the timestamp poll, and Realtime shows the new messages.
* **Kept.** The push receiver, `uatis_event_receipts` and its daily trim, and the production `MT_PUBLIC_URL` check from ADR-041.

## Consequences

* FR-107, FR-170 to FR-174, FR-176, and FR-178 change (02.requirements.md). 04.architecture.md, 05.data-model.md, 06.api-spec.md, 07.security.md, 10.testing.md, and 11.operations.md follow.
* Marmitop no longer calls the `backend-uatis` event feed. `backend-uatis` may keep it for other clients.
* A lost push needs "Atualizar" (inbound messages) or a redelivery in `backend-uatis` (`POST /v1/deliveries/{id}/redeliver`).
