# ADR-025 — AI order assistant on WhatsApp

**Status:** accepted · 2026-10-17 · revised 2026-10-17 (owner review: narrow scope, cheapest model, usage limit with pay-by-usage) · revised 2026-10-18 (final review rulings, Decision 5)

## Question

The owner wants an AI to talk with customers on WhatsApp, take the order from the menu, ask "Retirada ou Entrega?", ask for the address when the answer is Entrega, and create the order in Marmitop. 01.briefing.md lists "Chatbot or AI replies" as out of scope for v1. Where does the AI run, which model does it use, what does it ask, and how is its use limited and charged?

Facts found on 2026-10-17:

* Inbound messages reach Marmitop through one function, `ingestInboundMessage` (`packages/http/src/services/messaging/ingest-inbound.ts`). The webhook, the event feed (ADR-023), the poll (ADR-002), and the dev simulator all call it. `runInboundAutomation` runs after it in the same transaction.
* `createOrderInTx` (`packages/http/src/services/orders/create-order.ts`) is the one code path for order creation. It loads prices, computes the total with core, applies the address rules, writes the first history row, sends `order_received`, records usage, and emits `order.created`.
* `orders.payment_method` is `not null`. Invoices read it (08.fiscal-mapping.md, `pagamentos[]`).
* backend-uatis has its own agent runtime (`agent-client`). Its agent writes replies straight into backend-uatis `messages`, outside the Marmitop inbox.
* `plans` holds monthly limits for orders, messages, and invoices. `usage_events` meters them. Nothing charges in v1 (ADR-008), and limits do not block (FR-155).
* Claude Haiku 5.5 (`claude-haiku-5-5`) costs $0.10 per million input tokens and $0.50 per million output tokens for prompts up to 100K tokens. It supports tool use, adaptive thinking, effort `low`, and prompt caching from 512 tokens. It has no server-side refusal fallback.

## Decision 1 — Where the AI runs

Options:

1. **The backend-uatis agent**, with HTTP tools that call the Marmitop public API.
2. **Marmitop as an external agent** that backend-uatis calls over `chat_completions`.
3. **The Marmitop worker** runs a Claude tool loop per inbound burst.
4. **Extraction only.** The AI fills a draft order and an attendant sends every reply.

| | 1. uatis agent | 2. external agent | 3. Marmitop worker | 4. extraction |
|---|---|---|---|---|
| Talks with the customer | yes | yes | yes | no |
| Human takeover in the Marmitop inbox | no | partial | yes | n/a |
| Order and price rules in one place | no | yes | yes | yes |
| Tests with a fake model | hard | medium | easy | easy |
| Changes or config in backend-uatis | yes | yes, sync call in its path | none | none |

Choice: **option 3**. It reuses the inbound, outbound, and order paths that already pass their tests, keeps every rule in Marmitop, and changes nothing in backend-uatis. Option 1 puts the logic in a project we must not modify. Option 4 does not talk with the customer. Claude Managed Agents was also checked: our tools must run host-side under RLS anyway, so it adds sessions and gives nothing.

## Decision 2 — What the AI asks

The AI asks for three things only:

1. the items (with size and quantity, and a short item note such as "sem cebola");
2. the fulfillment: "Retirada" (`pickup`) or "Entrega" (`delivery`);
3. for Entrega, the address: `logradouro`, `numero`, `bairro`, and `complemento` when the customer gives one. `cidade`, `uf`, and `codigo_municipio` default to the restaurant's values (FR-034).

The AI does not ask for the payment method, change, or order notes. It does not answer order-status questions.

**Payment method.** `orders.payment_method` becomes nullable. Null means "A definir". Staff set it in the order detail. The invoice pre-check (FR-125) asks for it before "Emitir NF". Other options were a fake enum value `a_definir` (wrong data in reports and the fiscal mapping) and a per-restaurant default (silently wrong when the customer pays another way). Null is the honest value.

**Confirmation.** The order is created after one short confirmation. When the three items are complete, the server sends a summary (items, total, Retirada or the address) and the customer answers "sim". The model never writes the summary and never computes money. This adds one message per order and prevents orders the customer did not mean. The FR-029 initial status still applies: orders start as `aguardando` unless "Aceitar pedidos automaticamente" is on.

## Decision 3 — Model

Choice: **`claude-haiku-5-5`** with adaptive thinking and effort `low`. `MT_AI_MODEL` and `MT_AI_EFFORT` override them.

The task is narrow: match short pt-BR messages to a menu list and fill three fields through tools. Haiku 5.5 fits that task and is the cheapest current Claude model. Estimate per AI reply: about 6,000 cached prompt tokens, 2,000 new input tokens, and 300 output tokens, which is about $0.0005. An order takes 3 to 5 replies, so about $0.002 per order. The eval suite (FR-199) is the gate: if Haiku 5.5 fails it, the next step is `claude-sonnet-5-5` ($2 / $10), not a larger prompt.

Haiku 5.5 has no server-side refusal fallback. A `refusal` stop pauses the conversation for a human (FR-191).

## Decision 4 — Usage limit and pay by usage

* The meter is the **AI reply**: one customer message that got a turn with a model call. The turn writes a `usage_events` row with kind `ai.reply` and `ref_id` = the trigger message id, before its first model call. The `(kind, ref_id)` unique key makes a retry or a duplicate job of the same message count once. A turn that a guard stops before the model call does not count.
* Each plan has `included_ai_replies_month`. Seed values: Free 300, Pro 3,000. The owner sets the real numbers in `plans`.
* Each plan has `ai_overage_price_cents` per 100 extra replies. Seed value: 500 (R$ 5,00 per 100 replies). The owner sets the real price.
* When a restaurant uses its included replies, the assistant stops and pauses new conversations with reason `quota`, unless the admin turned on "Continuar e pagar pelo uso" (`ai_settings.allow_overage`). With overage on, the assistant continues, and Settings → Plano shows the extra replies and the amount due.
* `ai_settings.monthly_hard_cap` (default 20,000 replies) stops the assistant in every case. It protects the restaurant and Marmitop from a loop or an attack.
* Collection stays out of v1 (ADR-008). The overage amount is shown and recorded. A billing provider can charge it later without a change to the meter.

This makes the AI quota the one plan limit that blocks. FR-155 gets that exception.

## Rules that follow from these decisions

* **Port.** `AssistantModel` in `packages/core/src/ports` has two adapters: `AnthropicAssistantModel` (`@anthropic-ai/sdk`, in `apps/worker` only) and `ScriptedAssistantModel` (tests and local development). NFR-061 applies.
* **Loop.** A manual tool loop in the worker, capped at 6 model calls per turn.
* **Tenant scope comes from the job.** No tool takes a restaurant, customer, or conversation id. Every tool runs in `withRestaurantContext` for the job's restaurant.
* **Human first.** An attendant's reply pauses the AI for that conversation while the assistant is on. `handoff_to_human` pauses it too.
* **Off by default.** Each restaurant turns the assistant on in Configurações → Atendente IA.

## Decision 5 — Turn reliability (final review, 2026-10-18)

Question: how does a turn behave when messages arrive mid-turn, when the worker stops, when a call fails and retries, and when staff change data that an invoice uses?

Choices:

1. **What counts as an answer.** An outbound row answers trigger T only when it is an attendant reply after T, or an AI message after T whose run saw T (its trigger is T or a later inbound). Option rejected: count any AI message after T. It left a message that arrived during a running turn with no reply.
2. **Budget and shutdown are separate signals.** A 100-second budget abort fails the turn (`deadline`) and pauses it with `model`. A worker-shutdown abort retries after 5 seconds with no pause. Option rejected: one shared signal. A deploy would pause every in-flight conversation.
3. **Fixed retry delay.** A retryable model error retries after 20 seconds, not the ADR-007 backoff, because a job becomes `stale` 120 seconds after `enqueuedAt`. The retry keeps `enqueuedAt`.
4. **Bill once per customer message.** Usage is keyed on the trigger message, not the run. Option rejected: key on `ai_runs.id`. Each retry billed the same message again.
5. **Attendant pause only while the assistant is on.** Option rejected: pause always. With `auto_resume_minutes = 0`, conversations stayed paused after the admin turned the assistant on.
6. **Payment method and invoices.** A set payment method may change only while the order has no active invoice. Each change is audited (`order.payment_method_set`). Option rejected: allow any change. It could make the order disagree with an authorized NFC-e.

12.ai-order-assistant.md "Review rulings" lists every rule from the reviews.

## Consequences

* 01.briefing.md drops "Chatbot or AI replies" from the out-of-scope list.
* New requirements FR-180 to FR-199. FR-152, FR-153, FR-154, and FR-155 change for the AI meter. New phase P10.
* Migration 0020: `ai_settings`, `ai_carts`, `ai_runs`, conversation AI state, `messages.ai_run_id`, `orders.ai_run_id`, nullable `orders.payment_method`, the `ai.reply` usage kind, the plan AI columns, and the `mt_ai_turns` queue.
* Every place that reads `payment_method` handles null: the board card, the order detail, finance, reports, the public API (`payment_method: null`), outbound webhooks, and the invoice pre-check.
* `ANTHROPIC_API_KEY` is a worker secret. It is never logged and never stored in the database.
* Audio and image messages stay unsupported. The owner does not need them.
