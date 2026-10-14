# ADR-015 — v1 product rules

**Status:** accepted · 2026-10-13

## Question

Writing 02.requirements.md exposed five product rules that the goal does not state. Which rules does v1 use?

## Choices

| Topic | Options considered | Choice | Reason |
|---|---|---|---|
| `closed` automatic message frequency | Every inbound message; once per conversation per N hours | Once per conversation in 12 hours | Repeated replies to every message read as spam. |
| Who issues and cancels invoices (FR-135) | Admin only; everyone | **Attendant and admin issue. Only admin cancels.** | The attendant closes the sale at the counter or on delivery, so issuing is part of order handling. Cancelling has fiscal consequences and a short legal window, so only the admin can cancel. |
| Plan limits (FR-155) | Enforce; show only | Show only in v1 | No payment provider exists (ADR-008). Enforcing limits a customer cannot pay to raise blocks real work. |
| Revenue (FR-070) | All non-cancelled orders; `entregue` only | `entregue` only | This matches the board's "Faturamento entregue" KPI, so the two numbers agree. |
| Active customers (FR-073) | All contacts; customers with an order in the period | At least one `entregue` order in the period | A contact who never bought is not an active customer. |

## Consequences

* `order_invoices` writes: attendant and admin can insert. Only admin can request cancellation (service check plus RLS).
* Business rule for the 30-second poll: pg_cron 1.5 and later accepts `'30 seconds'` schedules, and Supabase ships pg_cron 1.6, so the 30-second interval stands.
