# ADR-020 — Finance page and payment status

**Status:** accepted · 2026-10-14

## Question

The owner asked for a Finance page. On it the manager sees every paid order, filters by customer and by date, and issues the invoices to the tax authority. Marmitop stores a payment method on each order (`pix`, `dinheiro`, `cartao_credito`, `cartao_debito`) but not whether the order was paid. What makes an order "paid", and how does the page issue invoices?

## Options

For the payment state:

1. **Derive it:** an order is paid when it is `entregue`. This needs no new data, but it is wrong for a Pix paid in advance, and wrong for an order delivered but not yet paid.
2. **Store it:** `orders.paid_at`. It is set automatically when the order reaches `entregue`, and staff can set it earlier or clear it by hand.
3. **Store a full payment ledger** (several payments per order, partial payments). This is more than v1 needs.

For invoice issue:

1. One order at a time from the Finance page.
2. One order at a time, plus a batch issue for selected orders.

## Tradeoffs

Option 1 is simple, but the manager needs to see a Pix that came in before delivery, and needs to exclude an order whose payment is still open. Option 2 adds one column and one action, and covers both cases. Option 3 belongs with a payment provider (ADR-008), which v1 does not have.

At the end of a day the manager issues many invoices, so a batch saves real time. A batch must still check each order on its own, because a delivery order without a CPF or a full address is blocked (ADR-016).

## Recommendation and choice

Option 2 for the payment state, and a batch issue.

* `orders.paid_at timestamptz null` and `orders.paid_by uuid null`.
* An order is **paid** when `paid_at is not null` and its status is not `cancelado`.
* The transition to `entregue` sets `paid_at` to the change time when it is still null. This keeps the reports rule (revenue = `entregue`, ADR-015) consistent with the Finance list.
* "Marcar como pago" and "Desmarcar pagamento" work from the order detail and the Finance page. Attendants and admins can mark an order paid. Only an admin can clear the mark. Every change writes an `audit_logs` row.
* Cancelling an order keeps `paid_at` for the record, but the Finance list excludes cancelled orders.
* **Finance page** at `/finance` (nav label "Financeiro"). Admin only, like Reports.
  * Filters: customer (search picker), date range on the payment date in the restaurant's timezone (default: the current month), and invoice state (all, no invoice, issued, failed or rejected).
  * The table shows code, payment date, customer, payment method, total, and invoice status, with an "Emitir NF" action per row.
  * Totals for the filtered set: order count, gross total, and the total broken down by payment method.
  * Batch: select orders, then "Emitir NF selecionadas". Each order runs the normal `issueInvoice` service. The result lists issued, blocked with the missing fields, and skipped (already has an active invoice).
  * Cursor pagination, 50 rows a page.

## Consequences

* Migration 0018 adds `paid_at` and `paid_by`, backfills `paid_at = delivered_at` for existing `entregue` orders, and indexes `(restaurant_id, paid_at)`.
* Requirements FR-160 to FR-169 cover the page. The order detail gains the payment mark.
* The NFC-e cancel window (ADR-016) makes a late batch issue harmless, but it does not help a late cancel. The page does not change cancel rules.
