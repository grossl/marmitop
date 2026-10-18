# P10 report: AI order assistant on WhatsApp

Spec: `12.ai-order-assistant.md`, ADR-025. Plan: `09.plan.md`.
Range: `61db1ab..28e2026` (24 commits).

## Done

| Task | Scope | Commits |
|---|---|---|
| Docs | Spec 12, data model, API, security, testing, operations | `781794a`, `09776a3` |
| 1 | Migration 0020 (AI tables, plan columns, seed) | `a5a21ab` |
| 2 | `AssistantModel` port and `ScriptedAssistantModel` | `b532e39`, `5336ac7` |
| 3 | AI cart rules and order summary | `44f17ce` |
| 4 | Turn rules, history mapping, tool specs | `5b36515`, `95c0f23` |
| 5 | Payment method may be "A definir" | `52d2068` |
| 6 | AI settings, schemas, AI reply quota | `d297b0c` |
| 7 | Assistant tools over menu, cart, summary, `createOrderInTx` | `e58d361`, `d4b6f24`, `8d49dfd` |
| 8 | Enqueue on inbound, pause on attendant reply | `87344ea` |
| 9 | Prompt and turn runner (guards, claim, tool loop) | `5fa48ae`, `57d0410` |
| 10 | Anthropic adapter and `mt_ai_turns` handler | `158f182`, `790bf3c` |
| 11 | Atendente IA settings, AI usage in Plano | `ff434f3`, `b6b3769` |
| 12 | AI state, Pausar/Retomar, needs-attendant filter, "IA" tags | `5748194` |
| 13 | `eval:ai` golden conversations | `bce72b3`, `cb2d752`, `28e2026` |
| 14 | This report | this commit |

Task numbers follow the phase brief. Run `git log --oneline 61db1ab..HEAD` for the full list.

### Design changes made during review

- Strict-tool-schema limits (`minLength`, `maximum`, and similar) moved from keywords to descriptions. The model API accepts only strict-supported keywords. Zod still enforces the limits.
- Cart lifetime uses the database clock, not the worker clock.
- The `answered` guard ignores automatic messages. An automatic reply no longer blocks the next turn.
- Model history always ends with the customer message. Trailing automatic text goes into the turn context.
- A turn has a 100 s budget.
- The handoff reply is kept. It is sent after the handoff.
- An existing pause is never overwritten.

## Verified

Run on branch `feat/v1-platform` at `28e2026`. No `ANTHROPIC_API_KEY` is set. No real model call ran.

| Command | Result |
|---|---|
| `bun run typecheck` | 9 of 9 tasks successful |
| `bun run test` | 8 of 9 tasks successful. 1,666 pass, 8 fail (all in `@mt/http`, all baseline) |
| `bunx biome check .` | 237 errors, 72 warnings, 31 infos. P10 added none (see below) |
| `bun run build` | 1 of 1 tasks successful (dashboard) |
| `bun run --cwd apps/worker eval:ai --dry` | 1/1 passed (100%), model scripted (dry), "Pedidos sem confirmação: 0" |

Test counts per workspace: worker 135, dashboard 76, core 502, schemas 117, api 87, db 304, config 1, http 444 pass and 8 fail.

### Baseline failures (8, not from P10)

All 8 are in `packages/http`. They exist before P10. Likely cause: the seed change in `64ecb79`.

- messaging welcome-preview: simulateInboundMessage, listConversations search, getConversation and markConversationRead (3)
- stock: listStockItems low flag and totals, archiveStockItem (2)
- outbound webhook: rotate returns a new secret (1)
- API: send outside the window is 422 (1)
- uatis webhook: restaurant B row with A's secret (1)

No failure outside this list.

### Biome

All 237 errors exist before P10. I checked the 28 errors that sit in files that P10 changed. These files are in 11 dashboard and http test files. Each file has the same error count at `61db1ab` as now (chat-panel 4, contacts-page 3, contacts-sidebar 2, finance-page 4, invoice-panel 2, messages-screen 1, messaging-format 1, orders-format 1, orders-page 5, settings-page 3, orders.integration.test 2). The other 209 errors are in files P10 did not touch. Files that P10 created have no errors.

## Risk remaining

- **No live model run yet.** Prompts, tool use, and pt-BR variety are tested only against `ScriptedAssistantModel`. The eval has 25 cases at most. Real customer variety is wider.
- **Cost and quota prices are seed values.** Quota size and overage price need an owner decision.
- **Nothing charges in v1.** Plano shows the amount due. No billing runs.
- **No audio.** Voice messages go to an attendant.
- **8 baseline failures** in `packages/http`. Fix them in a separate task.
- **Deferred minors.** See `.superpowers/sdd/2026-10-17-p10-ai-order-assistant/` (the per-task reports and the review notes).

## Pending: owner action

Both steps need `ANTHROPIC_API_KEY`. This environment has none.

1. Browser walk with the real model.
   - Start Supabase (54421-54423) and run `ANTHROPIC_API_KEY=... bun run dev`.
   - Open `http://localhost:3100`. As admin, turn on Configurações > Atendente IA. Plano shows "Respostas da IA".
   - In Conversas, use "Simular mensagem do cliente": "quero uma marmita de frango grande", then "retirada", then "sim".
   - Expect: an "IA" reply in about 15 s, a summary, a confirmation, and an order with the "IA" tag and "Pagamento: A definir".
   - As attendant, reply in a conversation. The header shows "IA pausada · equipe respondeu". Click Retomar.
2. Live eval.
   - `ANTHROPIC_API_KEY=... bun run --cwd apps/worker eval:ai`
   - Expect at least 90% pass and 0 orders without confirmation.
   - If Haiku 5.5 stays below 90% after two prompt rounds, run with `MT_AI_MODEL=claude-sonnet-5-5` and record both results. The owner picks the model.
3. Push: `git push origin feat/v1-platform` (no GitHub credentials here).
4. Record the measured cost per order from `ai_runs` in this report.
