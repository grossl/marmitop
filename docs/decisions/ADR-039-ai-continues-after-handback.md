# ADR-039 — The AI continues the order after a person gives the chat back

**Status:** accepted · 2026-11-03

## Question

A customer sent media during an order. The AI handed off with `unsupported_media`, as FR-190 says. While a person had the chat, the customer sent the street and number. An attendant then pressed Retomar. On the next message the AI handed off again.

The model reads the last 20 messages. They still hold "[mídia não suportada]" and the AI's own "a person will answer soon" text, and nothing in them shows that a person already dealt with that hand-off. The hand-off rule matches the old message again, so every resume ends in a new hand-off. How does the AI know that the old reason is closed, and continue the order?

## Options

1. **Cut the history at the resume.** The model no longer sees the old reason. It also loses the messages the customer sent to the person, such as the address, so it asks again.
2. **A flag in the turn context on the first turn after a resume.** It works for that turn only. On the next turn the old media message is still in the history with no flag.
3. **A marker in the history, plus a prompt rule.** The AI reply of a run that called `handoff_to_human` gets a `[sistema]` line: a person took the chat here and gave it back. The prompt says that hand-off reasons before the marker are closed. The model reads the whole conversation, including what the customer sent to the person, and continues the order.

## Tradeoffs

Option 3 keeps every customer message, and the marker stays in the history for every later turn. It costs one join in the history query. Options 1 and 2 are simpler, but option 1 loses order data and option 2 fixes one turn only.

## Choice

Option 3.

* The history query marks an AI message whose run called `handoff_to_human` successfully. The history adds the line `[sistema] Um atendente assumiu a conversa aqui e depois a devolveu ao assistente.` after that message (FR-218).
* A later turn runs only after Retomar or the automatic resume (FR-189), so the marker is true whenever the model sees it.
* The prompt: a hand-off reason before the marker is closed. Do not hand off again for it. Read the whole conversation, including messages the customer sent while the person had the chat, record their order data with `update_cart`, and continue the order. Hand off again only for a new reason in a customer message after the marker.
* A customer message that starts with `[sistema]` is still a customer message.
* `ai_runs.tool_calls` was written with a bare `::jsonb` cast, so most rows hold a JSON string, not an array (the pitfall in `packages/db/src/queue.ts`). The write now uses `::text::jsonb`, and migration 0031 turns the string rows back into arrays, so hand-offs from before this fix also get the marker.

## Consequences

* New FR-218. 12.ai-order-assistant.md "Request" and the system prompt change.
* The prompt snapshot test and the history tests change.
* Migration 0031 rewrites `ai_runs.tool_calls` string rows.
