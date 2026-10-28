# ADR-033 — Menu orders start as drafts and become orders on WhatsApp

**Status:** accepted · 2026-10-28 · supersedes the order creation and linking parts of ADR-031 and ADR-032

## Question

ADR-032 sends the menu order by WhatsApp. The customer still types a phone in the checkout. The owner wants that field removed: the customer sends the order from WhatsApp, so WhatsApp already gives the phone. But an order needs a customer, and `customers.phone` is `not null`. Without a phone at checkout, how does the order get made?

## Options

1. Create the order with a placeholder customer, and fix the customer when the message arrives. The customer list and the board show a fake customer until then. An order whose message never comes keeps it.
2. Do not store anything. The page sends only the text, and a person or the AI types the order. Prices are not checked, and the board shows nothing.
3. Store a draft. The checkout saves the cart, the address, the payment method, and the name as a draft with a random reference. The WhatsApp text carries the reference. When the message arrives, the sender's phone finds or creates the customer, and the draft becomes an order in the same transaction.

## Tradeoffs

Option 3 needs a table and code on the inbound path. In return:

* The board shows only orders that the customer really sent. A closed WhatsApp tab leaves a draft that expires, not an order that a person must cancel.
* The phone comes from WhatsApp, so it is always right. The order has its conversation from the start, so the per-phone link of ADR-032 goes away.
* The reference is random (8 characters from 31, about 40 bits). Order codes are sequential; a reference cannot be guessed. The first message with the reference wins; a forwarded copy finds a used draft and does nothing.

A draft can fail to convert: an item was archived, pickup was turned off, or the restaurant closed. Then the message is a normal message. The welcome or closed message and the AI run as for any message, and a person reads the order text.

## Recommendation and choice

Option 3.

* Table `menu_order_drafts` (migration 0028): `restaurant_id`, `reference` (unique per restaurant, `^[A-Z2-9]{8}$`), `payload` (the checkout input without the phone), `created_at`, `expires_at` (24 hours), `order_id`, `converted_at`. Tenant RLS like every table. Rows are never deleted in v1.
* `preparePublicOrder(deps, publicId, input)` replaces `placePublicOrder` (FR-232). It checks the input (`publicOrderSchema` without `phone`), the restaurant, the rate limit of 20 a minute per restaurant (FR-235; the per-phone limit goes away), and business hours (FR-234). It prices the cart with the order rules (`computeOrderTotal`, database prices, ADR-006), saves the draft, and returns `whatsappText` and the total. No order and no customer are created.
* `whatsappText` lists the items, the totals, delivery or pickup, the address, the payment, the notes, the name, and the line `Ref.: #REFERENCE` (FR-238). The page goes straight to `wa.me` with it (ADR-032). A restaurant without a phone cannot take menu orders: the page shows the menu, and checkout is off.
* On a new inbound message, `convertMenuOrderDraft` runs first (FR-239). It finds `#REFERENCE` in the text and locks an open draft (`order_id is null`, not expired) of this restaurant. When the restaurant is open, it fills the customer's empty name and address parts (FR-233), and runs `createOrderInTx` with `source = menu`, `requireConfirmation: true`, and the conversation, inside a savepoint. The order gets `order_received` through `createOrderInTx`. The draft gets `order_id`. The welcome and closed messages and the AI turn are skipped, and the AI pauses with reason `attendant`. When the conversion fails, the savepoint rolls back and the message goes the normal way.

## Consequences

* ADR-031's identity option 2 (phone typed in the form) and ADR-032's per-phone link are replaced.
* An abandoned checkout leaves an expired draft, not an order.
* The checkout no longer shows an order code. The customer gets the code in `order_received` on WhatsApp.
