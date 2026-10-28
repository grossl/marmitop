# ADR-032 — Menu orders are sent by WhatsApp

**Status:** accepted · 2026-10-28 · amends ADR-031

## Question

ADR-031 creates the public menu order with no conversation. The restaurant cannot send the first WhatsApp message: outside the 24-hour window, WhatsApp accepts only approved templates. The owner wants the customer to start the conversation. The customer sends the full order to the restaurant's WhatsApp. How does the order reach WhatsApp, and how does the order get its conversation?

## Options

**Where the order is created.**

1. Do not create the order. The page only opens WhatsApp with the order text. A person or the AI assistant types the order again. Prices on the page and on the board can differ, and the board shows nothing until someone types it.
2. Create the order as in ADR-031, then open WhatsApp with the order text and the order code. The board shows the order at once, and prices come from the database (ADR-006).

**How the order gets its conversation.**

1. Find the order code in the message text. Codes are short and sequential. A stranger who sends another order's code gets that order's status messages.
2. Link by phone. The inbound message creates or finds the customer by the sender's phone (FR-048). Open menu orders of that customer with no conversation get the conversation. WhatsApp proves the phone, so status messages go only to the person who wrote from it.

## Tradeoffs

Option 2 for creation puts an order on the board before the customer sends the message. A customer who closes WhatsApp without sending leaves an `aguardando` order with no conversation. A person sees it and cancels it. That is the same risk as ADR-031.

Link by phone needs the form phone to be the WhatsApp phone. The form says so. When the phones differ, the order keeps no conversation, as in ADR-031, and a person links the two by hand.

The AI assistant (12.ai-order-assistant.md) reads every inbound message. It does not know about menu orders, so it could create the order a second time from the text.

## Recommendation and choice

Creation option 2, linking option 2.

* `placePublicOrder` also returns `whatsappText`: the full order as plain text with the code, the items (quantity, name, size, line total), subtotal, delivery fee, total, delivery or pickup, the address, the payment method, change for cash, notes, and the name (FR-238). `formatMenuOrderMessage` in `@mt/core` writes it from the stored order rows, so the text shows the database prices.
* The checkout button reads "Enviar pedido pelo WhatsApp". After the order, the page opens `https://wa.me/{restaurant phone}?text={whatsappText}`. On a phone or tablet it opens at once. On a desktop the page shows the button "Abrir WhatsApp", because a browser blocks a new tab that opens after an `await`. The page also shows the code and the button again in case WhatsApp did not open. The restaurant phone is `restaurants.phone`. With no phone, checkout works as in ADR-031 and the page says the restaurant will confirm the order.
* An inbound message that creates a new message row runs `linkMenuOrders` in the ingest transaction (FR-239). It sets `conversation_id` on the customer's orders with `source = menu`, `conversation_id is null`, status `aguardando`, created in the last 24 hours. For each linked order:
  * The welcome and closed messages are skipped for this message; `order_received` goes out for the order (FR-039), inside the 24-hour window that the customer's message just opened.
  * The AI turn for this message is skipped, and the conversation pauses with reason `attendant`. A person confirms the order on the board (ADR-031). The pause ends by itself after `auto_resume_minutes` (FR-189).
* Status messages after the link follow FR-201 to FR-205, because the order now has a conversation.

## Consequences

* ADR-031's line "no WhatsApp message goes to the typed phone" still holds: messages go only to a phone that wrote first.
* An order whose customer never sends the message stays without a conversation. The board shows it as "Cardápio online".
* No migration: `orders.conversation_id` is already nullable, and the `system` context can update it.
