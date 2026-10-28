# ADR-036 — The order_received text for an order confirmed at creation

**Status:** accepted · 2026-10-28 · amends FR-039, FR-213, FR-240

## Question

`order_received` uses the restaurant's text, by default "Recebemos seu pedido! Em breve confirmaremos os detalhes." Some orders are confirmed when they are created: with "Aceitar pedidos automaticamente" (`auto_accept`), with the AI switch (FR-213), and with the menu switch (FR-240). For those orders the text is wrong. On 2026-10-28 order ORD-002 sent "Em breve confirmaremos os detalhes." and "foi confirmado" in the same second. The owner wants this text for a confirmed order: "Recebemos seu pedido! Avisaremos quando seu pedido estiver pronto." for pickup, and "Recebemos seu pedido! Avisaremos quando seu pedido for enviado." for delivery. Where does that text come from?

## Options

1. Two new editable automatic message kinds. The restaurant edits them in Configurações like the others. That needs new kinds in the database checks, the default rows, the settings screen, and the template rules.
2. A fixed text in `@mt/core`, chosen by fulfillment, used only for an order that is confirmed at creation. The restaurant's `order_received` text stays for an order that waits for a person.

## Tradeoffs

Option 2 is small and fixes the wrong text at once. The restaurant cannot edit the confirmed text. The `enabled` switch of `order_received` still applies, and outside the 24-hour window the configured template still goes out. Option 1 can follow when an owner asks to edit the text.

## Recommendation and choice

Option 2.

* `decideOrderReceived` takes `confirmedFor`: the fulfillment of an order confirmed at creation, or null. When it is set, the body is `CONFIRMED_ORDER_RECEIVED_TEXT[fulfillment]`.
* `createOrderInTx` takes `confirmOnCreate`. It sends `order_received` with the confirmed text, then moves the order to `confirmado` with actor `system`, which sends `order_confirmed` (FR-201). An order created as `confirmado` by `auto_accept` also gets the confirmed text.
* The menu conversion (FR-240) and the AI `place_order` (FR-213) pass `confirmOnCreate` instead of their own status move.

## Consequences

* A confirmed order sends "Recebemos seu pedido! Avisaremos quando …" and then `order_confirmed`, when both are enabled.
* An order that waits for a person still sends the restaurant's `order_received` text.
