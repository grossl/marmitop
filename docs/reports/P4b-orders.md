# P4b — Orders

Scope: FR-020 to FR-039 (board, KPIs, status moves, cancel, detail, new order).

## Done

Services in `packages/http/src/services/orders/`, each built with `defineService`, `minRole: "attendant"`:

| Appendix A name | Service | File |
|---|---|---|
| `listOrders` | `listOrders` | `list-orders.ts` |
| `getOrderKpis` | `getOrderKpis` | `list-orders.ts` |
| `getOrder` | `getOrder` (items, history; invoices join in P6) | `list-orders.ts` |
| `createOrder` | `createOrder` | `create-order.ts` |
| `changeOrderStatus` | `changeOrderStatus` | `change-status.ts` |
| `cancelOrder` | `cancelOrder` | `change-status.ts` |
| not in Appendix A | `getOrdersBoard` (first load: day, timezone, orders, KPIs in one transaction) | `list-orders.ts` |
| not in Appendix A | `getOrderFormData` (products for today's weekday, fee, pickup flag, city defaults) | `order-form.ts` |
| not in Appendix A | `lookupCustomers`, `quickCreateCustomer` (picker and inline create only) | `customer-lookup.ts` |

Schemas added to `packages/schemas/src/orders.ts`: `listOrdersActionSchema`, `getOrderActionSchema`, `lookupCustomersActionSchema`, `quickCreateCustomerActionSchema`.

Server Actions: `app/(app)/pedidos/actions.ts` (list, kpis, get, change status, cancel) and `app/(app)/novo-pedido/actions.ts` (create, lookup customers, quick-create customer). All use `memberAction`.

Dashboard: `orders-page.tsx`, `manual-order-page.tsx`, `orders-format.ts` (pure display helpers), and both route pages.

Rules applied:
* Status moves use core `applyTransition`. The service returns `allowedStatuses` (core `allowedTargets`) on each card, so the browser never imports `@mt/core` (it pulls `node:crypto`).
* Board = orders created on the restaurant-local day plus every order still open from earlier days.
* KPIs: delivered revenue and count use `delivered_at` on the local day and `entregue` only (ADR-015). In progress, ready, and out-for-delivery count the orders in those statuses now, so they match the columns.
* Drag: optimistic status, rollback plus toast on error. A final order cannot be dragged. A drop on `Cancelado` opens a reason dialog.
* The board has a seventh column, `Cancelado`, per FR-020.
* Realtime: `useRealtimeTable("orders")` calls `router.refresh()`.
* `createOrder`: prices, weekday, and delivery fee come from the database (ADR-006). Address parts copy from the customer, and city/UF/IBGE default to the restaurant's (ADR-016). Pickup is refused when the setting is off. `change_for` must cover the total. Code from `mt.next_order_code`. Status from `initialStatus(auto_accept)`.
* After create the page goes to `/pedidos?novo=<id>`, which highlights the card for six seconds.
* `/novo-pedido?conversation=<id>&customer=<id>` pre-selects the customer, sets source `whatsapp`, and links the conversation. Invalid UUIDs in the query are ignored.
* Left as marked comments in `create-order.ts`: `// P5: enqueue order_received` and `// P7: order.created webhook + usage_events`.

## Verified

* `bun run typecheck`: pass (9 of 9 tasks).
* Unit tests: `shared.test.ts` (address line, LIKE escape, board view), `orders-format.test.ts`, schemas. Pass.
* `bun run --cwd apps/dashboard build`: pass.

## Pending

* `packages/http/src/services/orders/orders.integration.test.ts` is written but has not run. Docker is down. It covers: total and snapshot, address defaults, auto-accept, pickup toggle, weekday filter, cross-restaurant item and customer, change-for, code sequence, forward skip and history, no-op, pickup never `saiu`, cancel with reason, final-status rejection, search, KPI day boundary, board load, quick-create, picker.
* No browser run of the drag, dialog, and new-order flows (no database).

## Risks

* postgres.js nested fragments (`tx\`\`` inside a query) and `in ${tx(ids)}` are used in list, create, and lookup. Typecheck passes, but the first integration run will confirm the SQL.
* The board loads at most 500 orders (`BOARD_LIMIT`).
* The optimistic override clears when the refreshed props arrive. Two quick moves of different cards are fine. A realtime refresh that lands mid-request can flash the old column for one frame.
* `quickCreateCustomer` duplicates a small part of the messaging domain's `createCustomer`. When that service lands, the picker can switch to it.
* No DB change needed.
