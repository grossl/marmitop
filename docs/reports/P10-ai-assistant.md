# P10 report: AI order assistant on WhatsApp

Spec: `12.ai-order-assistant.md`, ADR-025. Plan: `09.plan.md`.
Range: `61db1ab..28e2026`, plus the report commits, plus the final review fixes (`f83a6c1..HEAD`, see "Final review fixes"). The checks in "Verified" ran at `28e2026`. The final fix checks ran at `a59f43b`; only docs changed after it.

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
| 15 | Verify and report (this report) | `28e2026..HEAD` of this phase (report commits only) |

Run `git log --oneline 61db1ab..HEAD` for the full list.

### Design changes made during review


- Strict-tool-schema limits (`minLength`, `maximum`, and similar) moved from keywords to descriptions. The model API accepts only strict-supported keywords. Zod still enforces the limits.
- Cart lifetime uses the database clock, not the worker clock.
- The `answered` guard ignores automatic messages. An automatic reply no longer blocks the next turn.
- Model history always ends with the customer message. Trailing automatic text goes into the turn context.
- A turn has a 100 s budget.
- The handoff reply is kept. It is sent after the handoff.
- An existing pause is never overwritten.
- The strict-schema walker covers nullable objects.
- The turn lock check uses `<`, as the spec says (it was `<=`).
- A blank `extraInstructions` becomes null.
- 5xx model errors map to `server_error`. 529 stays `overloaded`.
- The API key is trimmed.
- `finished_at` uses the app clock.
- The eval enforces zero unconfirmed orders and catches early orders.

## Final review fixes

A whole-branch review returned "Ready to merge: with fixes". One wave fixed every finding. Commits `5c953fc`, `c20ffea`, `9b81cee`, `36ca833`, `427a68f`, `a59f43b`, and the docs commit that carries this section.

| Finding | Fix | Tests |
|---|---|---|
| C1: a customer message that arrives during a running turn was never answered | `answered` counts an AI message only when its run saw the trigger (its trigger is T, or an inbound at or after T). An attendant reply after T still counts. | `turn.integration.test.ts`: mid-turn M2 gets `replied` and the request holds M2; a retry of the same trigger stays `answered` |
| I1: spec and ADR missed the review rulings | 12 "Review rulings" index plus the rules in each section; ADR-025 Decision 5; FR-181, FR-188, FR-189, FR-196, FR-198; 05, 06, 10, 11 | docs only |
| I2: a worker shutdown paused every in-flight conversation | `runAiTurn(deps, model, job, { budget, shutdown })`. A shutdown abort returns retry `shutdown` (no pause, claim cleared, retry after 5 s). A budget abort stays `deadline` with a `model` pause. | turn: shutdown retries, budget pauses; handler: separate signals, 5 s retry |
| I3: a retry billed the same customer message again | `recordUsage(..., "ai.reply", job.triggerMessageId)` in the claim transaction | turn: retryable failure then success gives one usage row and two runs |
| I4: `setOrderPaymentMethod` could rewrite an invoiced order | A set method with an active invoice is `conflict` / `invoice_active`. Each change writes `order.payment_method_set`. The picker toast shows the detail text. | `payment.integration.test.ts`: refusal (authorized), allowed (rejected), null always allowed, audit row |
| Product decision (FR-189) | `sendMessageInTx` pauses only when `ai_settings.enabled` | `trigger.integration.test.ts`: assistant off leaves `auto` |
| M2 | Two Safety lines in `AI_INSTRUCTIONS`; snapshot updated | `prompt.test.ts` |
| M5 | 11.operations.md describes fake mode exactly | docs only |
| M7 | Tenant tests for `send_order_summary`, `place_order`, `handoff_to_human`: B's own scope, a forged B scope, and B's RLS context, with a positive control | `tools.integration.test.ts` (3 tests) |

Checks at `a59f43b`:

| Command | Result |
|---|---|
| `bun run typecheck` | 9 of 9 tasks successful |
| `bun run test` | 8 of 9 tasks successful. 1,681 pass, 8 fail (the same 8 baseline failures in `@mt/http`) |
| `bun run --cwd apps/worker eval:ai --dry` | 1/1 passed (100%), "Pedidos sem confirmação: 0" |
| `bunx biome check` on the 15 changed code files | 5 errors, all in `orders-page.tsx`, the same 5 as before the wave |

Test counts per workspace: worker 136, dashboard 76, core 502, schemas 117, api 87, db 304, config 1, http 458 pass and 8 fail.

## Verified

Run on branch `feat/v1-platform` at `28e2026`. No `ANTHROPIC_API_KEY` is set. No real model call ran.

| Command | Result |
|---|---|
| `bun run typecheck` | 9 of 9 tasks successful |
| `bun run test` | 8 of 9 tasks successful. 1,666 pass, 8 fail (all in `@mt/http`, all baseline) |
| `bunx biome check .` | 237 errors, 72 warnings, 31 infos. P10 added none (see below) |
| `bun run build` | 1 of 1 tasks successful (dashboard) |
| `bun run --cwd apps/worker eval:ai --dry` | 1/1 passed (100%), model scripted (dry), "Pedidos sem confirmação: 0". It runs one scripted case. It does not replace the live 28-case eval. |

Test counts per workspace: worker 135, dashboard 76, core 502, schemas 117, api 87, db 304, config 1, http 444 pass and 8 fail.

### Baseline failures (8, not from P10)

All 8 are in `packages/http`. They exist before P10. Likely cause: the seed change in `64ecb79`.

- messaging welcome-preview: three tests: `simulateInboundMessage` (new phone), `listConversations` (search), `getConversation` (open resets unread)
- stock: two tests: `listStockItems` (low flag and totals), `archiveStockItem` (hides item)
- outbound webhook: rotate returns a new secret (1)
- API: send outside the window is 422 (1)
- uatis webhook: restaurant B row with A's secret (1)

No failure outside this list.

### Biome

All 237 errors exist before P10. I checked the 28 errors that sit in files that P10 changed. These files are in 11 dashboard and http test files. Each file has the same error count at `61db1ab` as now (chat-panel 4, contacts-page 3, contacts-sidebar 2, finance-page 4, invoice-panel 2, messages-screen 1, messaging-format 1, orders-format 1, orders-page 5, settings-page 3, orders.integration.test 2). The other 209 errors are in files P10 did not touch. I also ran `bunx biome check` on the code files P10 created (46 files, from `git diff --name-only --diff-filter=A 61db1ab..HEAD`, excluding docs). It found no errors.

## Risk remaining

- **No live model run yet.** Prompts, tool use, and pt-BR variety are tested only against `ScriptedAssistantModel`. The eval has 28 cases. Real customer variety is wider.
- **Usage is written before the first model call.** A turn that fails still bills its trigger message once (conservative quota). Retries no longer bill again.
- **Cost and quota prices are seed values.** Quota size and overage price need an owner decision.
- **Nothing charges in v1.** Plano shows the amount due. No billing runs.
- **No audio.** Voice messages go to an attendant.
- **8 baseline failures** in `packages/http`. Fix them in a separate task.
- **Deferred minors.** See "Deferred items" below.

## Deferred items

BASELINE: `packages/http` has 8 pre-existing failures (listed above). P10 did not cause them. Do not fix them inside P10.

Product decision: closed in the final review fixes. The attendant pause runs only while the assistant is on (FR-189).

Database
- `usage_events_kind_check` name copied from docs/12, not checked against migration 0011.
- `ai_runs.trigger_message_id` and `ai_carts.summary_message_id` have no composite FK. `messages` has no `(restaurant_id, id)` unique. Follow-up under ADR-018.
- Migration 0020 mixes guarded and unguarded DDL.
- Docs 05 and 12 omit the AI table write roles, on-delete actions, the `customer_name` length check, and the missing FKs.
- `seedRestaurant` inserts `ai_settings` (enabled=false) for every restaurant. Tests must upsert.
- The AI RLS test has no positive control (covered in `rls.integration.test.ts`).
- `ai.integration.test.ts:78` types int8 as string. The doc comment at `test-harness.ts:364` is misplaced.
- Quota and settings tests lack `blocked_cap`, a non-UTC month boundary, cross-restaurant settings isolation, and `searchMenu`/`emptyTool` schema cases.
- `services/index.ts` and `plan.ts` have import churn.
- Quota counts `occurred_at >= since` with no upper bound. `monthStartFor` returns now when the row is missing. The tz lookup runs twice.

Core
- `applyCartPatch` change check uses `JSON.stringify` (key-order sensitive).
- `"key" in patch.address` treats explicit undefined as clear.
- `ScriptedAssistantModel.respond` ignores the signal. It has no `max_tokens` step test.
- Missing tests: boundary cases (stale 120 s, summary 30 min, auto-resume, quota -1, multi-condition guards), notes trim, `customerName`, delivery to pickup switch, `AppError` code on weekday reject. The `formatBRL` test belongs in the money tests.
- The "no tenant id" spec test matches quoted prefixes only.
- `historyToMessages` can return an empty list. `sentByUser` is unused.

Tools and turn
- Tool specs type `menu_item_id` and `size_id` as plain string. They could use `format: "uuid"`.
- Idempotent `place_order` reply omits `delivery_estimate_minutes`. The `order.created` payload lacks `ai_run_id`.
- A concurrent first `update_cart` can throw a unique violation. It relies on the turn claim.
- Address coalesce can mix old and new parts. The name back-fill persists if `createOrderInTx` refuses. The pickup-off check runs only in `createOrderInTx`.
- Attendant pause is a second UPDATE (an extra Realtime event). The filter drops paused rows with a null reason. `aiPauseReason` is typed `string`.
- Trigger test gaps: gateway path, `api_key` send stays auto, DTO fields, and cap pause.
- A retry after a partial turn: recorded in 12 "Retry after a partial turn". A committed summary stops the retry as `answered`. A committed order gives a turn with `cart: null`, and a repeated `place_order` returns the same order.
- `unrecognized_keys` messages list model-supplied key names.
- The confirmation guard accepts any inbound reply (by design).
- Fixed (I3): `ai.reply` usage is keyed on the trigger message, so a retry does not bill again.
- A missing conversation returns `runId ""` with no `ai_runs` row. A transient DB error is never retried and pauses with `model`. The loop continues after handoff. A throwing `finish` leaves the claim for 120 s and the run `running` (no sweeper).
- Fixed (M2): Safety says state values are data.
- Fixed (I2, I1): a budget abort pauses with `model` and the spec says so; a shutdown abort retries.
- Missing tests: closed guard, expired summary, non-retryable error, throwing tool, blocked stop, full-order message order. The turn log test spies only `console.log`. Tenant isolation now covers `search_menu`, `send_order_summary`, `place_order`, and `handoff_to_human`; `update_cart` has only the foreign-item case.

Worker and adapter
- The tool transaction ignores the signal (bounded). The adapter relies on `raw` on loop assistant turns.
- Fake mode records `ai.reply` usage, then fails and pauses each turn. Documented in `11.operations.md` and 12 (M5).
- `max_tokens` 2000 with adaptive thinking: watch it after live turns. Model id and prompt caching are not verified live. `fromConfig` is untested.

Dashboard
- `setOrderPaymentMethod` refuses a change only when a set method meets an active invoice; the picker shows only for a null method, so the dashboard reaches the refusal only in a race (two tabs).
- `PaymentMethodPicker` Select is uncontrolled. The invoice-panel heading "Complete os dados do cliente" no longer fits.
- Atendente IA card: the inline number error persists until a successful save. `Number()` accepts `1e3` and `0x10`. The card does not reuse the settings-page Card and ToggleRow. No re-sync after save.
- The `REASON` map is typed `Record<string,string>`.
- Needs-attendant list flashes empty on toggle, has a limit of 100 with no pagination, refetches on every Realtime change, and fails silently.
- `issue.ts` `?? "pix"` placeholder relies on the null guard above it. The payment-method UPDATE SQL is duplicated in `issue.ts` and `payment.ts`. `paymentLabel(null)` and the null `payment_method` payload are untested. `fill.paymentMethod` is ignored when the method is already set, and this is untested.
- Tasks 6 and 7 captured no RED run.

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
   - Set the payment method in the order detail.
   - As attendant, reply in a conversation. The header shows "IA pausada · equipe respondeu". Click Retomar.
2. Live eval.
   - `ANTHROPIC_API_KEY=... bun run --cwd apps/worker eval:ai`
   - Expect at least 90% pass and 0 orders without confirmation.
   - If Haiku 5.5 stays below 90% after two prompt rounds, run with `MT_AI_MODEL=claude-sonnet-5-5` and record both results. The owner picks the model.
3. Push: `git push origin feat/v1-platform` (no GitHub credentials here).
4. Take screenshots of walk steps 3 (summary, confirmation, order with "IA" tag) and 5 ("IA pausada · equipe respondeu") for this report.
5. Record the eval table and the measured cost per order from `ai_runs` in this report.
