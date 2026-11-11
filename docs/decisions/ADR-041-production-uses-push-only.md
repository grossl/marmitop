# ADR-041 — Production uses push only

**Status:** accepted · 2026-11-11 · amends ADR-021, ADR-023 · the 60-second feed timer and the pull warning are superseded by [ADR-042](ADR-042-webhook-only-manual-refresh.md); the production `MT_PUBLIC_URL` check stays

## Question

"Ativar webhook" registers push when `MT_PUBLIC_URL` passes FR-172, and pull otherwise (ADR-023). A production deploy with a missing or bad `MT_PUBLIC_URL` therefore registers pull without a word. Pull reads the `backend-uatis` event feed every 3 seconds for each restaurant, and the worker calls `mt.enqueue_uatis_feed_pulls` every 3 seconds even when no restaurant is in pull mode. Production has a public https api. Should production allow pull at all?

## Options

1. **Keep the silent choice.** No change. A configuration mistake turns into a 3-second poll that nobody notices.
2. **Push only in production.** The api and the dashboard refuse to start without a valid `MT_PUBLIC_URL`. "Ativar webhook" refuses pull with a pt-BR error. The worker timer runs every 60 seconds, which is enough for the 5-minute push recovery read. Development keeps pull, so local work needs no tunnel.
3. **Push only everywhere.** Local work then needs a tunnel, which ADR-023 rejects.

## Tradeoffs

Option 2 turns a quiet mistake into a failed start, which the deploy shows at once. It costs one more required variable on the api and the dashboard. The worker never reads `MT_PUBLIC_URL`, so it does not require it. A restaurant registered in pull before this change keeps pull until the admin presses "Ativar webhook" again. Its feed read then runs once a minute, on the 60-second timer, and the 10-minute timestamp poll still runs. Settings → WhatsApp marks that restaurant.

The 5-minute push recovery read stays. It recovers pushes that `backend-uatis` gave up on, and it costs one feed call per restaurant every 5 minutes.

## Choice

Option 2.

* `readServerConfig` adds `MT_PUBLIC_URL` to `missing` when `MT_ENV` is production (an unset `MT_ENV` counts) and the value fails `checkPublicBaseUrl`. The worker passes `{ requirePublicUrl: false }`.
* `enableUatisWebhook` in production with a URL that fails FR-172 returns "Em produção o webhook precisa do modo Push: configure MT_PUBLIC_URL com a URL https pública da API." and calls nothing.
* In production the worker timer runs every 60 seconds and ignores `MT_UATIS_PULL_SECONDS` for its interval.
* `getUatisWebhookStatus` returns `pushRequired`. When it is true and the mode is pull, the panel shows a warning that asks the admin to press "Registrar novamente".

## Consequences

* FR-172, FR-174, and FR-178 change (02.requirements.md).
* 11.operations.md: `MT_PUBLIC_URL` is required for the api and the dashboard in production.
* The SQL in `0019_uatis_webhook_registration.sql` does not change.
