# Architecture decision records

ADR-014 to ADR-017 amend earlier ADRs. When two ADRs conflict, the newest wins. ADR-002 has an Amendment 1 for facts found while writing the API spec, and ADR-021 amends ADR-002 again (Amendment 3).

| ADR | Title | Decision |
|---|---|---|
| [001](ADR-001-monorepo-layout.md) | Monorepo layout | Bun workspaces and Turborepo with `apps/dashboard`, `apps/api`, `apps/worker`, and shared `packages/`. No `generation-api`. |
| [002](ADR-002-whatsapp-via-backend-uatis.md) | WhatsApp channel through backend-uatis | Send and receive through `backend-uatis`, with its webhooks and a 30-second reconciliation poll. The poll was required while its webhooks were not delivered (Amendment 1); ADR-021 makes the webhook the main path. |
| [003](ADR-003-invoices-via-web-nf.md) | Invoices through web-nf | Issue NFC-e and NF-e through `web-nf`. No NFSe in v1. |
| [004](ADR-004-dashboard-data-access.md) | Dashboard data access | The dashboard reads and writes through server-side services on `app_service`. The browser uses Supabase for Auth and Realtime only. |
| [005](ADR-005-auth-tenancy-roles.md) | Auth, tenancy, and roles | Supabase Auth, one restaurant per tenant with RLS, and two roles: `admin` and `attendant`. |
| [006](ADR-006-money-and-order-totals.md) | Money and order totals | Money is integer cents. The server computes totals and snapshots item names and prices. |
| [007](ADR-007-queues-and-jobs.md) | Queues and jobs | pgmq queues and pg_cron schedules, with idempotent jobs, backoff, and a `job_attempts` log. |
| [008](ADR-008-billing-interface.md) | Billing interface | A `BillingProvider` port with a null adapter. Usage is recorded and no provider is wired. |
| [009](ADR-009-outbound-webhooks-and-api-keys.md) | Outbound webhooks and API keys | Signed outbound webhooks to one URL per restaurant, and hashed `mtk_` API keys for integrators. |
| [010](ADR-010-document-style-skill.md) | Document style skill | Documents follow the `orwell-writing` skill. |
| [011](ADR-011-branch-and-push.md) | Branch and push | Work on `feat/v1-platform`, commit and push per phase, and open one pull request into `master`. |
| [012](ADR-012-secret-storage.md) | Secret storage | Per-restaurant secrets are encrypted in the `secrets` table with envelope encryption under `MT_KEK`. |
| [013](ADR-013-doc-08-fiscal-mapping.md) | Doc 08 becomes the fiscal mapping | `08.validation-templates.md` is replaced by `08.fiscal-mapping.md`: how an order becomes a `web-nf` request. |
| [014](ADR-014-whatsapp-service-window.md) | WhatsApp 24-hour service window | Send free text inside the window and an approved template for `order_received` outside it. With no template, mark the message `failed`. |
| [015](ADR-015-v1-product-rules.md) | v1 product rules | `closed` message once per conversation in 12 hours; attendant and admin issue invoices and only admin cancels; plan limits shown only; revenue and active customers count `entregue` orders; 30-second poll stands. |
| [016](ADR-016-structured-address-and-invoice-payload.md) | Structured addresses and frozen invoice payloads | Customers and orders store a structured address. Invoices freeze their request body. The delivery fee becomes an invoice item by default. No CEP lookup in v1. |
| [017](ADR-017-data-access-hardening-and-status-rules.md) | Browser write lockdown, status move rules, and send retries | `authenticated` gets no writes. Status moves may skip forward and go back one step. Sends are not retried after a timeout. `MT_ALLOW_PRIVATE_HOSTS` is dev only. `orders.source` has `api`. Keys are looked up by hash. Test and live keys behave the same. |
| [018](ADR-018-tenant-composite-fks.md) | Tenant composite foreign keys, no deletes, API key use | Child keys carry `restaurant_id` into the parent. Orders, messages, conversations, customers, and history rows are never deleted; menu and stock items are archived. `mt.touch_api_key` records key use. |
| [019](ADR-019-english-paths.md) | English names for routes, folders, and files | Routes, folders, file names, and identifiers use English (`/new-order`, `menu-page.tsx`). UI text stays pt-BR; fiscal and legal terms stay Portuguese. |
| [020](ADR-020-finance-page-and-payment-status.md) | Finance page and payment status | `orders.paid_at` marks an order paid; `entregue` sets it when empty; staff mark it, only admin clears it. `/finance` lists paid orders with filters and totals and issues invoices one by one or in a batch. |
| [021](ADR-021-uatis-webhook-registration.md) | Register and use backend-uatis webhooks | Settings registers the backend-uatis webhook through its API, seals the returned secret, and checks `organization_id` on receipt. Amended by ADR-023 for the poll cadence and the public-URL rule. |
| [023](ADR-023-uatis-event-feed-push-and-pull.md) | One backend-uatis event log, read by push or pull | A webhook is `push` when `MT_PUBLIC_URL` is public, `pull` otherwise; the worker reads the cursor feed every 3 seconds (pull) or 5 minutes (push). One handler for both, deduplicated by event id. No tunnel. |
