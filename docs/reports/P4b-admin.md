# P4b report: admin (reports and settings)

Scope: FR-070–079 (reports) and FR-080–099, FR-150–156 (settings, plan).

## Done

Services in `packages/http/src/services/admin/` (all `minRole: "admin"`):

| File | Services |
|---|---|
| `reports.ts` | `getReports`, `getReportPeriodDefault` |
| `settings.ts` | `getSettings`, `saveOrderPreferences`, `saveBusinessHours`, `saveAutomaticMessage` |
| `integrations.ts` | `connectWhatsApp`, `testWhatsAppConnection`, `disconnectWhatsApp`, `saveFiscalConfig`, `testFiscalConnection`, `saveWebhookEndpoint`, `rotateWebhookSecret`, `createApiKey`, `revokeApiKey` |
| `plan.ts` | `getPlanAndUsage` |
| `internal.ts` | sealed-secret and audit helpers (not exported) |

`saveProfile` and `getProfile` stay in `services/restaurant-profile.ts` and are reused.

Dashboard:

* `app/(app)/configuracoes/actions.ts` extended: one Server Action per Appendix A name above, plus `getSettingsAction` and `getPlanAndUsageAction`.
* `app/(app)/relatorios/actions.ts` new: `getReportsAction`, `getReportPeriodDefaultAction`.
* Both routes load real data in the Server Component. The reports period lives in the URL (`?from=&to=`).
* `components/reports-page.tsx` and `components/settings-page.tsx` use props. Tabs: Restaurante, Horários, Mensagens automáticas, WhatsApp/webhook/API, Notas fiscais, Plano.
* Removed per FR-097: "Regras de resposta" toggles, the generic integration list, "Adicionar integração".
* New helper `components/admin-format.ts` (+ unit test): BRL, money parsing, labels.

Design points:

* Reports reuse `@mt/core` `buildReport` and `summarize` over fetched delivered orders, so the numbers follow ADR-015. Per-month order count and average ticket use `summarize` per month. The top-items revenue column of the prototype is gone: core has quantity only.
* Secrets: `deps.secretBox.seal` into `secrets` rows. A rotation inserts a new row, repoints the integration, then deletes the old row. The browser sees "configurado" and last4 only. Leaving a secret field blank keeps the stored one.
* Plaintext leaves the server only for the API key at creation and the webhook secret at creation or rotation (shown once, FR-088/089).
* Audit rows (`audit_logs`): `secret.set` and `secret.delete` (kind, last4 / kind), `api_key.create` (kind, last4, prefix, environment), `api_key.revoke`, and integration save/connect/disconnect rows with no secret fields.
* URL rules: `makeXSchema({ allowPrivateHosts: deps.env !== "production" })`, applied inside `run`. Services take a loose input schema (strings) for the action layer, then re-parse strictly. DNS pinning stays with the worker (ADR-017).
* WhatsApp and fiscal test: `deps.gateways.whatsapp/invoices(conn).testConnection()`. A throwing gateway (real adapters arrive in P5/P6) becomes `status = error` with a generic message. The exception text never reaches the caller.
* Plan tab: `NullBillingProvider` fed by the `plans` row, usage from `usage_events` for the current local month, invoice history empty.

## Verified

* `bun run typecheck` passes (all workspaces).
* `bun test apps/dashboard packages/core packages/schemas`: 509 pass, 0 fail (includes `admin-format.test.ts`).
* `bun run --cwd apps/dashboard build` passes.

## Pending (needs Docker / local stack)

Integration tests are written but not run:

* `reports.integration.test.ts`: summary, 6-month and 14-day series, top items, tenant isolation, role, period limit.
* `settings.integration.test.ts`: `getSettings` has no plaintext, preferences, hours (midnight crossing, invalid sets), automatic messages (template rules), plan and usage.
* `integrations.integration.test.ts`: WhatsApp connect/test/disconnect with secret rotation and audit contents, fiscal save and test, webhook create/rotate (secret shown once), API key create/revoke, SSRF and role checks.

They use `FakeGateway`, `FakeInvoiceGateway`, and `FakeSecretBox`. The bug risk is highest in the fixture-dependent parts (direct `orders` inserts in the reports test).

## Risks and notes

* The real `UatisGateway` and `WebNfGateway` do not exist yet, so with `MT_UATIS_FAKE` / `MT_WEBNF_FAKE` unset the test buttons report an error.
* The WhatsApp template field is a plain text input (needs P5 `listApprovedTemplates` for a picker).
* Disconnecting WhatsApp deletes the integration row and its two secrets (hard delete is allowed for these tables; ADR-018 protects only the order, message, customer, menu, and stock tables).
* Calls to the gateway happen inside the service transaction (short). A slow gateway holds a connection until it answers.
* No DB change needed. No new dependency.
* `docs/06.api-spec.md` Appendix A names `getSettings` for profile plus everything else, which this implements as one call; the profile service is the same one `getProfileAction` uses.
