# ADR-021 — Register and use backend-uatis webhooks

**Status:** accepted · 2026-10-14 · amended by [ADR-023](ADR-023-uatis-event-feed-push-and-pull.md) (push or pull mode, event feed, poll cadence; the public-URL rule now picks the mode instead of disabling the button)

## Question

ADR-002 made the 30-second poll the only working inbound path, because the `backend-uatis` worker did not deliver customer webhooks. Commit `c887ef0` in `backend-uatis` (its ADR-009) now delivers them. How does Marmitop start using them?

Facts found in `backend-uatis` (2026-10-14):

* `POST /v1/webhooks` takes `{ url, events, description }` and answers `201` with the webhook and its signing `secret`. The secret is returned once only. `PATCH /v1/webhooks/{id}` changes `url`, `events`, or `status`. `DELETE /v1/webhooks/{id}` removes it. `GET /v1/webhooks/{id}/deliveries` lists the attempts.
* Events: `message.created`, `message.updated`, `conversation.updated`.
* Body: `{ id, type, created_at, organization_id, data: { message } }`. `data.message` is the stored message row, with `status` rendered as `{ state, errors }`.
* Headers: `X-Uatis-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "t.body")>`, `X-Uatis-Event`, `X-Uatis-Delivery`.
* The target URL must be `http` or `https` on the default port. The worker resolves the host and refuses private, loopback, and link-local addresses. There is no development override.

## Options

1. **The admin registers the webhook by hand** in the `backend-uatis` dashboard and pastes the secret into Marmitop.
2. **Marmitop registers it through the API.** A button in Settings calls `POST /v1/webhooks` with Marmitop's public URL and stores the returned secret.
3. Keep polling only.

## Tradeoffs

Option 1 has a copy step that fails silently when the URL or events are wrong. Option 3 adds 30 seconds of latency and never shows read or delivered ticks for outbound messages. Option 2 needs the restaurant's `backend-uatis` API key to be allowed to manage webhooks, and it needs a public URL. The API key is already stored, and production has a public URL by definition.

## Recommendation and choice

Option 2.

* **Registration.** Settings → WhatsApp gains "Ativar webhook". The service calls `POST /v1/webhooks` with `url = MT_PUBLIC_URL + /v1/webhooks/uatis/{restaurant_id}` and `events = [message.created, message.updated]`. It seals the returned secret as the restaurant's `uatis_webhook_secret` (ADR-012) and stores the `backend-uatis` webhook id in `integrations_whatsapp.uatis_webhook_id` (migration 0019). "Desativar webhook" calls `DELETE`. Registering again replaces the old webhook and its secret. A manually entered webhook secret remains possible for setups where the API key cannot manage webhooks.
* **Receiving.** The existing route `POST /v1/webhooks/uatis/{restaurant_id}` stays. It also checks that `organization_id` in the body matches the organization of the restaurant's API key, which it reads once at registration time and stores as `integrations_whatsapp.uatis_organization_id`. A mismatch gets the same 401 as a bad signature. `message.updated` moves outbound status forward (sent → delivered → read, or failed).
* **Poll as safety net.** While a webhook is registered and active, the reconciliation poll runs every 5 minutes instead of every 30 seconds (ADR-002 Amendment 1 stays the mechanism). Without a webhook, it stays at 30 seconds.
* **Public URL.** `MT_PUBLIC_URL` must be a public `https` URL on port 443. In local development that means a tunnel (for example `cloudflared tunnel --url http://localhost:3101`). If `MT_PUBLIC_URL` points at localhost or a private address, the button is disabled and Settings says why.
* **Status in Settings.** The WhatsApp tab shows the webhook state (active or not registered), the time of the last inbound webhook received, and the last five `backend-uatis` delivery attempts from `GET /v1/webhooks/{id}/deliveries`.

## Consequences

* Inbound latency drops from up to 30 seconds to about one second plus the HTTP call.
* Outbound messages show delivered and read ticks.
* Local end-to-end testing of webhooks needs a tunnel. The fake-server tests and `e2e-uatis/replay-webhook.ts` cover the path without one.
