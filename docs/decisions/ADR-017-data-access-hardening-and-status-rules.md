# ADR-017 — Browser write lockdown, status move rules, and send retries

**Status:** accepted · 2026-10-13

> **Amended by [ADR-028](ADR-028-status-flow-without-preparando.md) (2026-10-27).** `preparando` is no longer a status, and `entregue` is now `finalizado`. Choice 3 keeps its rules with the new names: delivery `aguardando → confirmado → pronto → saiu → finalizado`, pickup `aguardando → confirmado → pronto → finalizado`.

## Question

Writing 05.data-model.md and 07.security.md raised five points that earlier ADRs leave open.

## Choices

1. **The `authenticated` role gets no write grants.** It gets `select` only on `orders`, `messages`, and `conversations`, which Realtime needs (ADR-004). The browser holds the anon key and a session JWT. Any write grant would let it call PostgREST directly, change `total_cents`, or skip a status rule. All writes run through `app_service` and the service layer. The RLS role check reads the role from `restaurant_members` through `mt.set_context`, never from a value the code passes in. This is stricter than web-nf. Menu image uploads are the one exception: a `storage.objects` policy lets admins upload to `menu-images`.
2. **API keys act with the `attendant` role.** The public API has no menu or settings writes (06), so nothing needs more.
3. **Status moves.** This replaces the line in the chief brief.
   * A forward move may skip columns. An attendant who drags `aguardando` → `preparando` gets one history row with `from = aguardando` and `to = preparando`.
   * A backward move may go one step only.
   * `entregue` and `cancelado` are final.
   * Pickup orders never enter `saiu`.
   * Setting the same status again is a no-op and writes no history.
   * Reason: attendants work fast on the board, and a rejected drag is friction with no safety benefit.
4. **Outbound WhatsApp sends are not retried after a timeout.** `backend-uatis` `POST /v1/messages` takes no idempotency key, so a retry after an unclear failure can send the message twice. A timeout or a 5xx after the request left marks the message `failed` with `error_code = ambiguous`. The attendant can resend by hand. Connection errors before the request left are retried. This amends ADR-007: every queue is idempotent except this one, which is at-most-once. Follow-up outside this repo: add `Idempotency-Key` to `backend-uatis`.
5. **Private hosts in development.** The SSRF guard (ADR-009) also covers the admin-entered `backend-uatis` and `web-nf` base URLs. Local development runs both on localhost, so `MT_ALLOW_PRIVATE_HOSTS=1` disables the guard. The worker and api refuse to start with it set when `MT_ENV=production`.
6. **Order source.** `orders.source` accepts `counter | phone | whatsapp | api`. API-created orders use `api`, so reports can tell them apart.
7. **API key lookup** uses the unique SHA-256 hash (`mt.api_key_lookup`). No prefix lookup step is needed.
8. **Test keys do not change behavior.** `mtk_test_` and `mtk_live_` reach the same data and the same gateways. Gateway choice (real or fake) comes from deployment config only (`MT_UATIS_FAKE`, `MT_WEBNF_FAKE`).

## Amendment 1 — `order_invoices` on Realtime (2026-10-14, P6)

The orders board shows an invoice badge per card (FR-139). Polling every card is wasteful, so `order_invoices` joins `supabase_realtime` (migration 0017). `authenticated` gets `select` on `order_invoices` by column only: `id`, `restaurant_id`, `order_id`, `kind`, `status`, `created_at`, `updated_at`. `request_payload` (CPF/CNPJ and address), `error_message`, and the cancel columns stay off the browser path. The row policy is the same as for `orders` (member restaurants). Still no write grant. Point 1 now reads: `select` on `orders`, `messages`, `conversations`, and the status columns of `order_invoices`.
