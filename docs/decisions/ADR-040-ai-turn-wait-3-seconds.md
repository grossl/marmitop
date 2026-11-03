# ADR-040 — The AI turn waits 3 seconds, not 8

**Status:** accepted · 2026-11-03 · amends ADR-025

## Question

Each inbound message enqueues an AI turn with an 8-second delay (FR-181). The delay lets a customer finish a burst of short messages, so one turn answers all of them. Measured on the local stack, the delay is about a third of the reply time: about 9 seconds of a typical 18–43 seconds. The model takes 2–9 seconds. The owner wants faster replies. How long does the turn wait?

## Options

1. **Keep 8 seconds.** Fewest model calls per burst. The slowest reply.
2. **3 seconds.** Most bursts on WhatsApp come within a few seconds. A message that comes later still gets its own turn: the earlier job is `superseded` when it is not for the latest inbound message, and a message that arrives during a running turn gets its own turn (12 "Guards in the worker").
3. **No delay.** Every message in a burst starts a model call, and most of them end as `superseded`. More cost and more locked retries.

## Tradeoffs

Option 2 saves about 5 seconds on every reply. A slow typist may get one more turn, which costs one more model call and uses one more `ai.reply` from the quota (FR-196). The guards already make that turn safe: it reads the whole history and the cart. Option 3 saves 3 more seconds and makes bursts expensive.

## Choice

Option 2. `AI_TURN_DELAY_SECONDS` is 3.

## Consequences

* FR-181 and 12.ai-order-assistant.md "Flow" and "Trigger" change.
* The larger part of the wait is outside the AI: without a registered `backend-uatis` webhook, Marmitop reads inbound messages every 30 seconds (ADR-023). "Ativar webhook" in Configurações moves that to the 3-second feed.
