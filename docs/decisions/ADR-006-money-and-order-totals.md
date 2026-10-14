# ADR-006 — Money and order totals

**Status:** accepted · 2026-10-13

## Question

How do we store money, and who computes the order total?

## Choice

* All money is integer cents (`bigint`), as in web-nf. The UI formats it as BRL.
* The server computes the total. The client sends item ids, size ids, and quantities only. The service loads current prices, rejects unavailable items or items not offered on the weekday, and writes an `order_items` snapshot (name, size name, unit price, quantity, notes).
* `total = sum(unit_price × qty) + delivery_fee`. The delivery fee comes from restaurant settings and applies to delivery orders only.
* Order codes are `ORD-NNN`, from a per-restaurant sequence.

## Consequences

* A later price change never alters an existing order.
* `packages/core` holds `computeOrderTotal`, which is pure and unit-tested.
