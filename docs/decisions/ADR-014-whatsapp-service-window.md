# ADR-014 — WhatsApp 24-hour service window

**Status:** accepted · 2026-10-13

## Question

WhatsApp allows free text only within 24 hours after the customer's last message. `backend-uatis` returns `422 outside_service_window` otherwise. Welcome and closed replies always follow an inbound message, so they are safe. Two cases are not safe. The first is the `order_received` message for a counter or phone order from a customer who has not written recently. The second is an attendant reply sent after 24 hours. What does Marmitop do?

## Options

1. Send free text and mark the message `failed` when `backend-uatis` refuses it.
2. Send an approved template outside the window. Templates need Meta approval and are managed in `backend-uatis` (`/v1/templates`).
3. Do not send automatic messages outside the window.

## Tradeoffs

Option 1 is simple but hides a predictable failure. Option 3 silently drops the order confirmation. Option 2 is the only way to reach the customer, but it needs a template that the restaurant has created and Meta has approved.

## Recommendation and choice

Option 2 with fallback to Option 1.

* `automatic_messages` gains `template_name` and `template_language` (nullable). Settings → Mensagens automáticas lets the admin pick one from `GET /v1/templates/approved` for `order_received`.
* The service checks the window from the customer's last inbound `messages.created_at`. Inside the window it sends free text. Outside the window, it sends the template when one is configured. With no template, it sends nothing and marks the message `failed` with `error_code = outside_service_window`.
* The chat composer shows "Fora da janela de 24h" and disables free text when the window is closed. Template sending from the composer is out of scope for v1.

## Consequences

* A unit test covers the window decision (inside, outside with a template, outside without one).
