# ADR-025 — AI order assistant on WhatsApp

**Status:** accepted · 2026-10-17

## Question

The owner wants an AI to talk with customers on WhatsApp, read what they ask for, match it to the menu, collect the fulfillment (`delivery` or `pickup`), the address, and the payment method, and create the order in Marmitop. 01.briefing.md lists "Chatbot or AI replies" as out of scope for v1. Where does the AI run, how does it act on Marmitop data, and which safeguards does it need?

Facts found on 2026-10-17:

* Inbound messages reach Marmitop through one function, `ingestInboundMessage` (`packages/http/src/services/messaging/ingest-inbound.ts`). The webhook, the event feed (ADR-023), the poll (ADR-002), and the dev simulator all call it. `runInboundAutomation` runs after it in the same transaction.
* `createOrderInTx` (`packages/http/src/services/orders/create-order.ts`) is the one code path for order creation. It loads prices, computes the total with core, applies the address rules, writes the first history row, sends `order_received`, records usage, and emits `order.created`.
* Outbound messages go through the `mt_outbound_messages` queue and the worker (ADR-007).
* backend-uatis has its own agent runtime (`agent-client` Edge Function). It calls an external agent over `chat_completions` or `a2a`, or runs a lightweight agent with MCP, SQL, and HTTP tools. Its agent writes the reply straight into backend-uatis `messages`.
* backend-uatis can transcribe audio and read images (`media-preprocessor`, Gemini). Marmitop stores non-text messages as `[mídia não suportada]` (ADR-002 Amendment 1).

## Options

1. **Use the backend-uatis agent.** Configure an AI agent in backend-uatis with HTTP tools that call the Marmitop public API (`/v1/orders`, a new menu route).
2. **Marmitop is an external agent for backend-uatis.** Marmitop exposes a `chat_completions` endpoint. backend-uatis `agent-client` calls it on every inbound message and sends the reply.
3. **The Marmitop worker runs the agent.** A new queue `mt_ai_turns` gets one job per inbound burst. The worker calls the Claude Messages API with Marmitop tools, runs the tools in-process against the database under RLS, and sends the reply through the existing outbound path.
4. **Extraction only.** No conversation. The AI reads the chat and fills a draft order. An attendant reviews it in the dashboard and sends every reply.

## Tradeoffs

| | 1. uatis agent | 2. Marmitop as external agent | 3. Marmitop worker | 4. Extraction only |
|---|---|---|---|---|
| Talks with the customer | yes | yes | yes | no |
| Prices and totals from server code | through the public API | yes | yes | yes |
| Human takeover in the Marmitop inbox | no: uatis replies on its own | partial: uatis sends | yes | n/a |
| Cart state across turns | no store | yes | yes | yes |
| Tests with a fake model | hard: logic lives in uatis | medium | easy: a port with a fake | easy |
| Changes to backend-uatis | agent config per restaurant | agent config, sync HTTP in its request path | none | none |
| Failure blast radius | uatis and Marmitop | a slow Marmitop blocks uatis | Marmitop worker only | none |

Option 1 puts the order logic and the system prompt in a project we must not modify, and its replies skip the Marmitop inbox rules (pause, audit, automatic messages). Option 2 couples backend-uatis uptime to a long synchronous call. Option 4 is the safest, but it does not do what the owner asked: talk with the customer. Option 3 keeps every rule in one place and reuses the inbound, outbound, and order paths that already pass their tests.

Claude Managed Agents was also checked. Its loop and sandbox run at Anthropic. Our tools must read and write the tenant database under RLS, so they would run host-side anyway. It adds a session per conversation and gives nothing that a plain tool loop does not.

## Recommendation and choice

Option 3. The design details are in [12.ai-order-assistant.md](../12.ai-order-assistant.md). The main rules:

* **Port.** `AssistantModel` in `packages/core/src/ports` has two adapters: `AnthropicAssistantModel` (Claude Messages API, `@anthropic-ai/sdk`) and `ScriptedAssistantModel` (tests and local development). NFR-061 applies.
* **Model.** `claude-opus-5-5` with adaptive thinking and effort `low`. `MT_AI_MODEL` and `MT_AI_EFFORT` override them. The request enables server-side refusal fallbacks (`fallbacks: "default"`). The system prompt and the menu block use prompt caching.
* **Loop.** A manual tool loop, not the SDK Tool Runner. The worker records each step in `ai_runs`, caps the loop at 8 model calls, and stops on any stop reason it does not expect.
* **The model never computes money.** Tools return prices and totals that `computeOrderTotal` produced. The order summary that the customer confirms is a server-rendered message, not model text.
* **Two-step order placement.** `send_order_summary` sends the server-rendered summary and records the cart version. `place_order` succeeds only when the cart has not changed since that summary and the customer sent a message after it. The model decides whether that message is a "yes".
* **Tenant scope comes from the job, never from the model.** No tool takes a `restaurant_id`, `customer_id`, or `conversation_id`. The worker runs every tool inside `mt.set_context` for the job's restaurant.
* **Human first.** An attendant's reply pauses the AI for that conversation. The `handoff_to_human` tool pauses it too. Orders follow FR-029: they start as `aguardando` unless "Aceitar pedidos automaticamente" is on, so staff still accept each order on the board by default.
* **Off by default.** Each restaurant turns the assistant on in Configurações → Atendente IA.

## Consequences

* 01.briefing.md moves "Chatbot or AI replies" out of the out-of-scope list. The "Regras de resposta" toggles stay out of the UI. The Atendente IA card replaces them.
* New requirements FR-180 to FR-199 in 02.requirements.md. New phase P10 in 09.plan.md.
* New migration: `ai_settings`, `ai_carts`, `ai_runs`, conversation AI state, `messages.ai_run_id`, `orders.ai_run_id`, and the `mt_ai_turns` queue.
* `ANTHROPIC_API_KEY` is a worker secret. It is never logged and never stored in the database (ADR-012 applies to any later per-restaurant key).
* Each AI turn costs money. `ai_runs` records tokens per run, and `ai_settings.daily_run_cap` bounds the spend per restaurant.
* Audio and image messages stay unsupported. Brazilian customers often send audio, so audio transcription is the first follow-up (see 12.ai-order-assistant.md, "Later").
