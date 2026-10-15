# ADR-024 — The local stack uses real data and the real sibling stacks

**Status:** accepted · 2026-10-15 · amends ADR-017 (fake gateway default) and 11.operations.md "Local development"

## Question

The dashboard reads every screen from Postgres. But the local seed fills those tables with about 4,600 lines of generated demo content: six months of orders, customers, conversations, a menu, stock, and invoices. Its integrations also point at fakes (`127.0.0.1:4010` and `127.0.0.1:4020`), and the env files set `MT_UATIS_FAKE=1` and `MT_WEBNF_FAKE=1`. So a developer never sees the real flow: a message from `backend-uatis`, an order, an invoice from web-nf. Which data and which gateways does the local stack use?

## Options

1. **Keep the demo seed and the fakes.** Every screen looks full at once. But the data comes from nobody's use, and the gateways never leave the process.
2. **Keep the demo seed, use the real gateways.** The fake orders and conversations do not exist in `backend-uatis` or web-nf, so the two sides disagree from the first reset.
3. **Seed accounts and configuration only, use the real gateways.** Every operational row comes from use of the apps or from the sibling stacks.

## Tradeoffs

Option 3 starts with empty screens. Reports, Finance, and the board show their empty states until someone creates data. In return:

* What the dashboard shows is what Marmitop and its siblings did. No screen can hide a bug behind seeded rows.
* The WhatsApp and invoice flows run through the real adapters (`UatisGateway`, `WebNfGateway`) and the SSRF guard.
* The seed drops from about 4,600 lines to about 160.

The sibling stacks must run for sends, polls, and invoice issues to succeed. With them down, the worker records failed attempts in `job_attempts`, as in production.

## Recommendation and choice

Option 3.

**The seed holds:**

* the four logins (password `qweqwe`), the two restaurants, and their members;
* `restaurant_settings`, `business_hours`, and `automatic_messages`;
* the public API keys;
* for Marmita da Casa only, `integrations_fiscal`, which points at the local web-nf on its ADR-001 port.

**The seed leaves empty:** `customers`, `conversations`, `messages`, `menu_items`, `stock_items`, `orders`, `order_invoices`, `usage_events`, `webhook_endpoints`, and `integrations_whatsapp`. `scripts/dev-seed/verify.ts` checks that each one holds zero rows after a reset.

**Fiscal integration.** It uses web-nf's own seeded dev fixtures, copied into `scripts/dev-seed/constants.ts`: base URL `http://127.0.0.1:3002` (the generation API), the `nfk_test_` key and webhook secret of ACME Comércio de Roupas from `web-nf/supabase/seed.sql`, environment `homologacao`. Marmitop does not change the sibling projects.

**No seeded WhatsApp integration.** `backend-uatis` accepts only `obk_` keys, which it stores as hashes. Its seed has one key, `1234567890`, an older row with no hash and no prefix. `backend-uatis` reads that value as a session token and answers `400` ("Session callers must send X-Org-Id"). No seeded key can authenticate, so the seed connects no WhatsApp integration. To connect one:

1. Sign in to the `backend-uatis` dashboard (`http://localhost:3300`, `qwe@qwe.com`) and create an `obk_test_` key with role `admin`.
2. In Marmitop, Configurações → WhatsApp, save `http://127.0.0.1:3301`, that key, and the `phone_number_id`, then press "Ativar webhook".

The `admin` role covers sends, the poll, and the webhook. Sabor de Minas has no integration of either kind, so its admin tests the Configurações screens from zero.

**Gateways.** `scripts/local-dev.ts` writes `MT_UATIS_FAKE=0` and `MT_WEBNF_FAKE=0`. Set either to `1` to go back to the in-process fake (ADR-017). The fakes stay for the unit and contract tests. `MT_ALLOW_PRIVATE_HOSTS=1` stays, because the siblings listen on `127.0.0.1`.

**Tests.** The integration tests do not use the dev seed. They create their own rows in `mt_test` (10.testing.md), so this change does not affect them.
