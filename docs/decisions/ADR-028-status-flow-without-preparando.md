# ADR-028 — Status flow without `preparando`, and `entregue` becomes `finalizado`

**Status:** accepted · 2026-10-27

## Question

The owner wants a shorter order flow. `preparando` adds a step that the kitchen does not use: a confirmed order is already in preparation. `entregue` reads wrong for pickup orders and for orders the restaurant closes for other reasons. The last step only closes the order, and the customer gets no message for it. What does the new flow look like, and what happens to existing data?

## Options

1. **Hide `preparando` in the board only.** The status stays in the database and in the public API. Two names for one state, and old orders keep a status that the board cannot show.
2. **Remove `preparando` and rename `entregue` to `finalizado` everywhere:** core, database, public API, webhooks, reports, dashboard. Existing rows are migrated.
3. **Add `finalizado` and keep `entregue` as an alias.** Every report and filter must accept both values.

## Tradeoffs

Option 2 touches the most code, but it leaves one name per state. Marmitop has no external API clients yet, so a change to the public `status` enum breaks nobody. Options 1 and 3 keep dead values that every later change must remember.

## Choice

Option 2.

**Flow.**

| Fulfillment | Flow |
|---|---|
| Delivery | `aguardando → confirmado → pronto → saiu → finalizado` |
| Pickup | `aguardando → confirmado → pronto → finalizado` |

ADR-017 rules stay: forward moves may skip steps, a back move goes one step, `finalizado` and `cancelado` are final, any non-final status may move to `cancelado`, and pickup orders never enter `saiu`.

**`finalizado` replaces `entregue` in every rule.** It is final. It sets `delivered_at` and, when it is null, `paid_at` (FR-160). Revenue, reports, customer totals, and the "Entregues hoje" count use it. An order in `pronto`, `saiu`, or `finalizado` can get an invoice. The column keeps the name `delivered_at`; it means "the time the order was finalized".

**Status messages.** `order_preparing` and `order_delivered` go away. `finalizado` sends no message. The four status kinds are `order_confirmed`, `order_ready` (pickup only), `order_out_for_delivery`, and `order_cancelled`. With `welcome`, `closed`, and `order_received`, a restaurant has seven automatic messages.

**Migration 0025.**

* `orders`: `preparando → confirmado`, `entregue → finalizado`. The update bypasses the transition trigger, because it is a rename and not a move.
* `order_status_history`: `entregue → finalizado` in both columns. `preparando` becomes `confirmado`, and rows that become `confirmado → confirmado` are deleted.
* The `orders.status` check, `mt.order_transition_allowed`, the transition trigger, the `paid_at` trigger, and `mt.insert_default_automatic_messages` use the new names.
* `automatic_messages`: delete the `order_preparing` and `order_delivered` rows and remove both kinds from the check. `messages.automatic_kind` keeps both values, because sent messages are a record.

**Public API and webhooks.** The `status` enum is `aguardando, confirmado, pronto, saiu, finalizado, cancelado`. `order.status_changed` carries the new names.

## Consequences

* ADR-017 (flow), ADR-026 (status kinds), ADR-027 (defaults) are amended by this ADR.
* FR-021 to FR-029, FR-200, FR-201, FR-084, and the reports and finance requirements change their status names.
* 05.data-model.md, 06.api-spec.md, and 06.openapi.yaml change.
* Board columns: Aguardando, Confirmado, Pronto, Saiu, Finalizado.
