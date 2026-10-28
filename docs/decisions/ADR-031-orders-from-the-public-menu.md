# ADR-031 — Orders from the public menu

**Status:** accepted · 2026-10-27 · extends ADR-030 · amended by ADR-032 and ADR-033

## Question

The owner wants the customer to order on the public menu page (ADR-030). The customer picks items, types a name and an address, picks a payment method, and the order goes to the board. The page has no session. Almost every customer opens it on a phone. Who is the customer, which rules apply, and how is the form protected from abuse?

## Options

**Customer identity.**

1. Name and address only. The order needs a `customers` row, and `customers.phone` is `not null` and E.164. A placeholder phone would make the customer list useless and leave the restaurant no way to call back.
2. Name, phone, and address. The phone finds the customer, or creates one.
3. A WhatsApp or SMS code before the order. Strong, but it needs a sender and a new flow. Too much for v1.

**Order rules.**

1. A new code path for public orders.
2. `createOrderInTx`, the path of the dashboard, the API, and the AI. Prices, sizes, weekdays, totals, the delivery fee, the address rule, the order code, the first history row, usage, and the `order.created` event stay one code path (ADR-006, ADR-017).

**First status.**

1. Follow "Aceitar pedidos automaticamente".
2. Always `aguardando`, like an AI order (FR-211). A person confirms it on the board.

## Tradeoffs

Anyone can type any phone. With identity option 2, a stranger can order under another person's phone. Three controls limit the harm. The order always starts as `aguardando`, so a person sees it before the kitchen does. The order has no conversation, so `order_received` is skipped and no WhatsApp message goes to the typed phone when the order is created. Rate limits stop floods. A saved customer's name and address are never replaced, so a stranger cannot change them.

A new code path would drift from the others. `createOrderInTx` already takes a `source` and a `requireConfirmation` flag.

## Recommendation and choice

Identity option 2, rules option 2, first status option 2.

* The page is designed for a phone first (FR-237). A cart bar stays fixed at the bottom of the screen with the item count and the subtotal. The checkout opens as a full-height sheet from the bottom. Buttons and steppers are at least 44 px high. Inputs use a 16 px font, so iOS does not zoom, and they set `inputMode` and `autoComplete` (`tel`, `name`, `street-address`). The layout has no horizontal scroll at 320 px.
* The customer adds items, picks a size, changes quantities, and opens "Finalizar pedido". The form asks for name, phone, delivery or pickup (pickup only when `allow_pickup`), the address for delivery (rua, número, complemento, bairro), the payment method, the change amount for cash, and notes (FR-230, FR-231).
* A Server Action without a session calls `placePublicOrder(deps, publicId, input)` in `@mt/http` (FR-232):
  1. Zod checks the input (`publicOrderSchema`).
  2. `mt.public_restaurant_id(public_id)`, a definer function for `app_service`, finds the restaurant. An unknown id is `not_found`.
  3. Rate limits in `rate_counters`, class `menu_order`: 20 orders a minute for the restaurant, and 3 a minute for one phone at one restaurant (FR-235).
  4. In one transaction with a `system` context: the restaurant must be open (`isOpenAt`, FR-234). The customer is found by phone or created. An empty saved name (equal to the phone) and empty address parts are filled; saved values never change (FR-233). Then `createOrderInTx` runs with `source = 'menu'`, `requireConfirmation: true`, and no conversation.
* `orders.source` gets the value `menu`, shown as "Cardápio online" (FR-236).
* `mt.public_menu` also returns `allow_pickup`, `delivery_fee_cents`, and the business hours. The page shows "Fechado agora" and turns off checkout when the restaurant is closed (FR-234).
* After the order, the page shows the order code, the total, and "Aguardando confirmação do restaurante" (FR-231).

## Consequences

* The board, the customer list, the reports, and the outbound webhooks see public orders like any other order, with `source = menu`.
* Public orders have no conversation. The status message rules for orders without a conversation apply (FR-200 to FR-205).
* A wrong phone produces a real order that a person must cancel. A confirmation code (identity option 3) can come later.
* The public API enum `source` gets `menu` (06.openapi.yaml).

## Amendment 1 — 2026-10-27

The first layout was a phone column, also on a computer. The owner wants the page to work in a desktop browser and a phone browser. The layout now follows three breakpoints (FR-237):

* Phone (< 640 px): one column, the cart bar fixed at the bottom, checkout full screen.
* Tablet (640–1023 px): items in two columns, the same cart bar, checkout as a bottom sheet.
* Desktop (>= 1024 px): the page is up to 1152 px wide. Items are in two columns beside a sticky cart panel. Checkout opens as a side panel. There is no bottom bar.

Category links stay under the header at every size and scroll sideways on a phone.
