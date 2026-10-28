# ADR-037 — The AI uses the saved address for delivery

**Status:** accepted · 2026-10-28

## Question

A returning customer chose Entrega, and the AI asked for the street, number, and neighborhood again. The customer record already had them. The turn context sends `saved_address` to the model, but no rule tells the model to use it, and the cart starts with an empty address. How does the AI reuse the saved address?

## Options

1. **Prompt only.** Tell the model to copy `saved_address` into `update_cart`. The turn context holds the address as one joined string, so the model must split it into fields. A cheap model can split it wrong or still ask.
2. **Server fill, plus a prompt rule.** When `update_cart` leaves a delivery cart with an empty address, the server copies the customer's saved address fields into the cart. The prompt tells the model not to ask for an address that the cart already has. The summary shows the address, so the customer can correct it.

## Tradeoffs

Option 2 is deterministic and keeps the address fields exact. The customer still sees the address in the summary before the order, and a reply such as "agora é na Rua Nova, 9" leads to `update_cart` with the new address and a new summary. Option 1 costs no code, but it depends on the model.

## Choice

Option 2.

* `update_cart` fills the cart address from the customer's saved `logradouro`, `numero`, `bairro`, and `complemento` when the cart is for delivery, the input gives no address value, and the cart address is empty. An address in the input always wins (FR-217).
* The prompt: for Entrega, when the `update_cart` result already has an address, do not ask for it. The summary shows it, and the customer can change it.
* A new address in the cart does not replace the saved one. FR-187 stays.

## Consequences

* New FR-217. 12.ai-order-assistant.md "Tools" and the system prompt change.
* The prompt snapshot test changes.
