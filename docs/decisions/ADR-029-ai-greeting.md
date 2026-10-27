# ADR-029 — The AI greets the customer, and asks a new customer's name

**Status:** accepted · 2026-10-27

## Question

In the first interaction the customer got two greetings. The automatic `welcome` ("Olá! Bem-vindo à Copacabana. Como podemos ajudar?") went out with the inbound message, and the AI turn 8 seconds later greeted again ("Olá! Bem-vindo à Copacabana. O que você gostaria de pedir hoje?"). The owner also wants the first greeting to depend on the customer: ask a new customer's name, and greet a known customer by name and ask for the order.

## Options

**Duplicate greeting.**

1. Tell the AI to say nothing when `welcome` went out. The customer then gets the generic text and no name question.
2. Skip `welcome` when the AI will answer the message. The AI writes the only greeting.

**Who greets, and how.**

1. A fixed server text, like the summary.
2. The AI, from a rule in the prompt and a `first_reply` flag in the turn context. The server decides the facts (first reply, known name); the model writes the words, and it can also react to an order in the first message.

## Choice

Option 2 in both cases.

* `runInboundAutomation` skips `welcome` when `enqueueAiTurn` will enqueue a turn for the message: the assistant is on, the conversation is not paused, the restaurant is open, and the quota allows it. In every other case `welcome` and `closed` behave as before (FR-214).
* The turn context has `first_reply: true` when the conversation has no outbound message before the trigger. On the first reply the AI greets with the restaurant name. With no saved name (`customer_name` null) it asks for the customer's name. With a saved name it greets the customer by name and asks what they want to order (FR-215).
* `update_cart` with a `customer_name` fills the customer's empty saved name at once, so the customer is known in the next conversation even without an order. A saved name is never replaced (FR-216, extends FR-187).

## Consequences

* New FR-214 to FR-216. The prompt snapshot changes.
* The `welcome` card in Configurações → Mensagens says that the Atendente IA greets instead while it is on.
