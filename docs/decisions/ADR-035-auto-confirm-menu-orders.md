# ADR-035 — Auto-confirm menu orders

**Status:** accepted · 2026-10-28 · amends ADR-031, ADR-033

## Question

A menu order always starts as `aguardando`, also with "Aceitar pedidos automaticamente" on (ADR-031, FR-232). A person confirms it on the board. Some owners trust the menu orders and want them confirmed at once. How does a restaurant turn that on?

## Options

1. Let "Aceitar pedidos automaticamente" (`auto_accept`) also cover menu orders. The order starts as `confirmado`. One switch then controls the counter, the API, and the menu. An owner who wants only the menu confirmed cannot have it. A created-as-`confirmado` order also sends no `order_confirmed` message, because no status move happens.
2. A separate switch, `restaurant_settings.auto_confirm_menu_orders`, default off. The order is created as `aguardando` and then moved to `confirmado` with actor `system` in the same transaction. This is the rule of the AI assistant's switch (FR-213, ADR-027 Amendment 1).

## Tradeoffs

Option 2 adds a column and a switch. The status move writes two history rows and sends `order_confirmed` (FR-201), so the customer learns on WhatsApp that the order is confirmed. The conversation is new and the customer just wrote, so the message goes out as text inside the 24-hour window.

## Recommendation and choice

Option 2.

* Migration 0029 adds `restaurant_settings.auto_confirm_menu_orders boolean not null default false`.
* Configurações → Pedidos has the switch "Confirmar pedidos do cardápio online automaticamente" (`saveOrderPreferences`, FR-240).
* `convertMenuOrderDraft` runs `createOrderInTx` as before. When the switch is on, it then runs `changeOrderStatusInTx(..., "confirmado")` with actor `system`, inside the same savepoint.
* The AI still pauses on the conversation (ADR-033). It still does not know menu orders.

## Consequences

* With the switch on, the customer gets `order_received` and then `order_confirmed`, when both messages are enabled.
* `auto_accept` keeps its meaning for the other order sources.
