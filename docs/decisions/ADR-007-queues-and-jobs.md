# ADR-007 — Queues and scheduled jobs

**Status:** accepted · 2026-10-13

## Question

Outbound WhatsApp messages, outbound webhooks, invoice jobs, and reconciliation polls must run outside the request. What runs them?

## Options

1. pgmq and pg_cron in Supabase Postgres, consumed by `apps/worker` (web-nf ADR-002).
2. A plain `jobs` table with `FOR UPDATE SKIP LOCKED`.
3. Redis or a hosted queue.

## Tradeoffs

The fixed stack in web-nf excludes Redis. Option 2 reimplements visibility timeouts that pgmq already provides. Option 1 matches web-nf and its operations runbooks.

## Recommendation and choice

Option 1. Queues: `mt_outbound_messages`, `mt_webhook_deliveries`, `mt_invoice_jobs`, `mt_sync`. pg_cron enqueues reconciliation polls (ADR-002, ADR-003). Each job is idempotent. Retries back off at 1m, 5m, 30m, 2h, and 8h, and every attempt is recorded.

## Consequences

* Automatic messages (welcome, closed, order received) are enqueued in the same transaction as the event that triggers them.
