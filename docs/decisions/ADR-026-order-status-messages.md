# ADR-026 — Order status messages on WhatsApp

**Status:** accepted · 2026-10-20

## Question

01.briefing.md says the customer "gets the order status through the chat". Today only `order_received` goes out, when the order is created (FR-112). A status move on the board writes a history row and emits the `order.status_changed` webhook, but sends nothing to the customer. Which status moves send a WhatsApp message, with which text, and under which rules?

## Options

1. **One fixed message per status, in code.** No settings. The restaurant cannot change the text or turn a message off.
2. **One automatic message kind per target status**, configured in Configurações → Mensagens like `welcome`, `closed`, and `order_received`. Each kind has its own on/off switch, text, and optional WhatsApp template.
3. **One `status_changed` kind with a single text** that uses a `{{status}}` variable. One switch for all statuses.

## Tradeoffs

Option 1 is the smallest change, but restaurants write in their own voice, and some do not want a message for every step. Option 3 has one switch, so a restaurant cannot send "saiu para entrega" without also sending "em preparo", and one sentence reads badly for both "pronto para retirada" and "cancelado". Option 2 reuses the existing automatic-message model: the table, the settings card, `renderMessage`, the 24-hour window decision (FR-117, ADR-014), the template fields, and the outbound queue. It adds six rows per restaurant.

## Choice

Option 2.

**Kinds and defaults.** The migration inserts one row per restaurant for each kind. The restaurant can edit or turn off each one.

| Kind | Sent when the order moves to | Default | Default text |
|---|---|---|---|
| `order_confirmed` | `confirmado` | on | Olá {{nome}}! Seu pedido {{pedido}} foi confirmado e logo entra em preparo. |
| `order_preparing` | `preparando` | off | Seu pedido {{pedido}} está sendo preparado. |
| `order_ready` | `pronto`, pickup orders only | on | Seu pedido {{pedido}} está pronto! Pode vir retirar no {{restaurante}}. |
| `order_out_for_delivery` | `saiu` | on | Seu pedido {{pedido}} saiu para entrega! |
| `order_delivered` | `entregue` | off | Pedido {{pedido}} entregue. Obrigado pela preferência, {{nome}}! |
| `order_cancelled` | `cancelado` | on | Seu pedido {{pedido}} foi cancelado. Se tiver dúvidas, responda esta mensagem. |

**Rules.**

* A message goes out only for the status the order moved to. A forward skip (`aguardando → preparando`) sends only the `preparando` message.
* A move back one step (ADR-017) sends nothing. A no-op move sends nothing.
* Each kind goes out at most once per order. A later return to the same status sends nothing. A `failed` row counts as sent: a late resend after a back-and-forth would reach the customer out of order.
* `order_ready` goes out only for pickup orders. A delivery order hears `saiu` instead.
* The order must have a WhatsApp conversation (`orders.conversation_id`). A counter order sends nothing.
* The status at creation sends no status message. `order_received` covers it, including an order that starts as `confirmado` with "Aceitar pedidos automaticamente".
* The 24-hour window applies as for `order_received` (FR-117): free text inside the window, the kind's approved template outside it, and a `failed` row with `error_code = outside_service_window` when there is no template.
* The message row and its outbound job are written in the same transaction as the status change. Every actor sends: dashboard user, API key, and system.
* Status messages are automatic messages (`sent_by` null, `automatic_kind` set), so the AI assistant's `answered` guard ignores them (ADR-025).

## Consequences

* New requirements FR-200 to FR-205. Migration 0021 widens the `kind` checks on `automatic_messages` and `messages`, and inserts the default rows.
* Configurações → Mensagens shows six more cards, each with the template fields.
* `order_received` keeps its own rules (FR-112).

## Amendment 1 — defaults for new restaurants (2026-10-20)

**Question.** Migration 0021 inserts the six status rows only for restaurants that exist when it runs. `mt.create_restaurant` inserts no `automatic_messages` rows, so a restaurant created later has every kind off, and its settings cards open with an empty text. `welcome`, `closed`, and `order_received` had the same gap.

**Choice.** A new restaurant gets one row for each of the nine automatic kinds. Migration 0022 adds `mt.insert_default_automatic_messages(p_restaurant_id)`, which holds the default texts and inserts the nine rows with `on conflict (restaurant_id, kind) do nothing`. `mt.create_restaurant` calls it.

| Kind | Default | Default text |
|---|---|---|
| `welcome` | on | Olá! Aqui é {{restaurante}}. Como podemos ajudar? |
| `closed` | on | Olá! Estamos fora do nosso horário de atendimento. Retornaremos assim que abrirmos. |
| `order_received` | on | Recebemos seu pedido! Em breve confirmaremos os detalhes. |
| six status kinds | as in the table above | as in the table above |

The `closed` and `order_received` texts come from the dev seed. The seed's `welcome` texts name a restaurant's style ("Bem-vindo à", "Uai"), so `welcome` gets a neutral text.

Migration 0022 does not back-fill the three older kinds for existing restaurants. A missing `welcome` or `closed` row means the restaurant never turned that message on; a back-fill would start sending messages that the restaurant did not choose.
