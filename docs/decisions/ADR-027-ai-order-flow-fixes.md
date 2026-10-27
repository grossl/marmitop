# ADR-027 — One summary, AI orders start as `aguardando`, every status move notifies

**Status:** accepted · 2026-10-26

> **Amended by [ADR-028](ADR-028-status-flow-without-preparando.md) (2026-10-27).** `order_preparing` and `order_delivered` no longer exist, so the rule that turns them on no longer applies. A new restaurant gets seven automatic messages, all on.

## Question

The first live test of the AI assistant (ADR-025) showed three problems:

1. The customer got the order summary twice. `send_order_summary` sent the server-rendered summary, which already ends with "Responda *sim* para enviar o pedido". The prompt then told the model to "ask whether you can confirm", so the model wrote the whole summary again in its own words.
2. The AI order ORD-002 started as `confirmado`, because "Aceitar pedidos automaticamente" (FR-029) was on. The restaurant saw no `aguardando` step for an order that a model built.
3. The move `confirmado → preparando` sent nothing, because `order_preparing` is off by default (ADR-026). The owner wants the customer to follow every status move.

## Options

**Duplicate summary.**

1. Change the prompt only. A cheap model can still repeat the summary.
2. Change the prompt, and drop the turn's text reply in code when `send_order_summary` succeeded in the same turn.

**Initial status of an AI order.**

1. Keep FR-029 for every order.
2. An order from `place_order` always starts as `aguardando`. A person confirms it on the board, and that move sends `order_confirmed`.

**Status messages that are off by default.**

1. Keep the ADR-026 defaults.
2. Turn `order_preparing` and `order_delivered` on by default, for new restaurants and for existing rows that still hold the untouched default (off, default text).

## Tradeoffs

A prompt-only fix depends on the model. The code guard is deterministic and costs nothing: the summary already asks for "sim", so a second text adds nothing.

Auto-accept is right for an order that a person typed. An AI order comes from a model reading free text, so a person must look at it before the kitchen starts. The `confirmado` move then tells the customer that the restaurant accepted the order, which keeps the chat in step with the board.

Two more messages per order cost little and match what the owner asked for. A restaurant can still turn each one off. Rows that an admin edited or turned on stay as they are.

## Choice

Option 2 in all three cases.

* After a successful `send_order_summary`, the turn sends no text reply. The run stays `replied`, because the summary is the reply. The tool result tells the model that the summary already asks for "sim" (FR-210).
* `place_order` creates the order as `aguardando`, whatever "Aceitar pedidos automaticamente" says. After `place_order`, the model gives the order code and says that the restaurant will confirm the order. It does not say the order is confirmed (FR-211).
* `order_preparing` and `order_delivered` default to on. Migration 0023 updates `mt.insert_default_automatic_messages` and turns on existing rows of those two kinds that are off and still hold the default text (FR-200, ADR-026 Amendment 2).

## Consequences

* FR-200 and FR-029 change. New FR-210 and FR-211.
* 12.ai-order-assistant.md "Reply", "Tools", and the system prompt change.
* The prompt snapshot test changes.

## Amendment 1 — no AI text after the order, and an auto-confirm option (2026-10-26)

**Question.** After "sim", the customer got two messages that said the same thing: `order_received` ("Recebemos seu pedido!") and the AI's own "Pedido recebido! Seu código é…". The owner wants the customer to hear "confirmado" only from a status move, and wants an option that confirms AI orders without a person.

**Choice.**

* After a successful `place_order`, the turn sends no text reply when an automatic message for that order went out (`order_received`, or `order_confirmed` from auto-confirm). The run stays `replied`. When no automatic message went out, for example with `order_received` off, the model still gives the order code (FR-212).
* `ai_settings.auto_confirm_orders` (default off) is a new switch in Configurações → Atendente IA: "Confirmar pedidos da IA automaticamente". When it is on, `place_order` creates the order as `aguardando` and then moves it to `confirmado` with actor `system`, in the same transaction, through `changeOrderStatusInTx`. That move sends `order_confirmed` (FR-201), so the customer hears "confirmado" from a status move in both modes. The restaurant setting "Aceitar pedidos automaticamente" still does not apply to AI orders (FR-211, FR-213).
* Migration 0024 adds the column.
