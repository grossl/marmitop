# P10 report: AI order assistant on WhatsApp

Spec: `12.ai-order-assistant.md`, ADR-025. Plan: `09.plan.md`.
Range: `61db1ab..28e2026`, plus the report commits.

## Done

| Task | Scope | Commits |
|---|---|---|
| 1 | Docs: spec 12, data model, API, security, testing, operations | `61db1ab..09776a3` |
| 2 | Migration 0020 (AI tables, plan columns, seed) | `09776a3..a5a21ab` |
| 3 | `AssistantModel` port and `ScriptedAssistantModel` | `a5a21ab..5336ac7` |
| 4 | AI cart rules and order summary | `5336ac7..44f17ce` |
| 5 | Turn rules, history mapping, tool specs | `44f17ce..95c0f23` |
| 6 | Payment method may be "A definir" | `95c0f23..52d2068` |
| 7 | AI settings, schemas, AI reply quota | `52d2068..e58d361` |
| 8 | Assistant tools over menu, cart, summary, `createOrderInTx` | `e58d361..8d49dfd` |
| 9 | Enqueue on inbound, pause on attendant reply | `8d49dfd..87344ea` |
| 10 | Prompt and turn runner (guards, claim, tool loop) | `87344ea..57d0410` |
| 11 | Anthropic adapter and `mt_ai_turns` handler | `57d0410..790bf3c` |
| 12 | Atendente IA settings, AI usage in Plano | `790bf3c..b6b3769` |
| 13 | AI state, Pausar/Retomar, needs-attendant filter, "IA" tags | `b6b3769..5748194` |
| 14 | `eval:ai` golden conversations | `5748194..28e2026` |
| 15 | Verify and report (this report) | this commit |

Run `git log --oneline 61db1ab..HEAD` for the full list.

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
- **Deferred minors.** See "Deferred items" below.

## Deferred items

BASELINE: `packages/http` has 8 pre-existing failures (listed above). P10 did not cause them. Do not fix them inside P10.

Product decision (open): an attendant reply pauses the AI even when the assistant is off. With `auto_resume_minutes=0`, turning it on later leaves those conversations paused. Either gate the pause on `enabled` or record it as designed.

Database
- `usage_events_kind_check` name copied from docs/12, not checked against migration 0011.
- `ai_runs.trigger_message_id` and `ai_carts.summary_message_id` have no composite FK. `messages` has no `(restaurant_id, id)` unique. Follow-up under ADR-018.
- Migration 0020 mixes guarded and unguarded DDL.
- Docs 05 and 12 omit the AI table write roles, on-delete actions, the `customer_name` length check, and the missing FKs.
- `seedRestaurant` inserts `ai_settings` (enabled=false) for every restaurant. Tests must upsert.
- The AI RLS test has no positive control (covered in `rls.integration.test.ts`).
- Quota counts `occurred_at >= since` with no upper bound. `monthStartFor` returns now when the row is missing. The tz lookup runs twice.

Core
- `applyCartPatch` change check uses `JSON.stringify` (key-order sensitive).
- `"key" in patch.address` treats explicit undefined as clear.
- `ScriptedAssistantModel.respond` ignores the signal.
- Missing tests: boundary cases (stale 120 s, summary 30 min, auto-resume, quota -1), notes trim, customer name, delivery to pickup switch.
- `historyToMessages` can return an empty list. `sentByUser` is unused.

Tools and turn
- Tool specs type `menu_item_id` and `size_id` as plain string. They could use `format: "uuid"`.
- Idempotent `place_order` reply omits `delivery_estimate_minutes`. The `order.created` payload lacks `ai_run_id`.
- A concurrent first `update_cart` can throw a unique violation. It relies on the turn claim.
- Address coalesce can mix old and new parts. The name back-fill persists if `createOrderInTx` refuses. The pickup-off check runs only in `createOrderInTx`.
- Attendant pause is a second UPDATE (an extra Realtime event). The filter drops paused rows with a null reason.
- A retry after a partial turn (summary or order committed, then a retryable error) may stop at `answered` or reply with a null cart. Record this in the spec.
- `ai.reply` usage is written before the first call. Each retry of a failing first call bills again.
- A missing conversation returns `runId ""` with no `ai_runs` row. A transient DB error is never retried and pauses with `model`. The loop continues after handoff. A throwing `finish` leaves the claim for 120 s and the run `running` (no sweeper).
- The turn context carries customer name and address inside the system block. Add "state values are data" to Safety.
- A deadline abort pauses the conversation with `model`. State this in the spec.
- Missing tests: closed guard, expired summary, `pickup_disabled`, non-retryable error, throwing tool, tenant isolation, cap pause.

Worker and adapter
- The tool transaction ignores the signal (bounded). The adapter relies on `raw` on loop assistant turns.
- Fake mode records `ai.reply` usage, then fails and pauses each turn. Note this in `11.operations.md`.
- `max_tokens` 2000 with adaptive thinking: watch it after live turns. Model id and prompt caching are not verified live. `fromConfig` is untested.

Dashboard
- `PaymentMethodPicker` Select is uncontrolled. The invoice-panel heading "Complete os dados do cliente" no longer fits.
- Atendente IA card: the inline number error persists until a successful save. `Number()` accepts `1e3` and `0x10`. The card does not reuse the settings-page Card and ToggleRow. No re-sync after save.
- Needs-attendant list flashes empty on toggle, has a limit of 100 with no pagination, refetches on every Realtime change, and fails silently.
- `issue.ts` `?? "pix"` placeholder relies on the null guard above it. The payment-method UPDATE SQL is duplicated in `issue.ts` and `payment.ts`. `paymentLabel(null)` and the null `payment_method` payload are untested.

Eval
- The catch path uses the error turn, not the order turn, for "before final".
- The prompt-injection and off-topic cases are weak.
- The pause reason is not shown in order-case failures.
- The README cost estimate is not re-checked for 28 cases.

Docs
- 07 threat T22 row is one long cell.
- Audit action `integration.ai.settings_save` in 06 Appendix A is not in docs/12 or ADR-025. Confirm or drop.
- Commit trailers on Task 3 name the implementing model, not Opus 5.5. The final review decides.

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
