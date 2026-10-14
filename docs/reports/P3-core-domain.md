# P3 — Core domain with tests

## What was done

`@mt/core` and `@mt/schemas` now hold the pure domain and the shared request schemas. Nothing in either package does I/O. Tests inject `Clock` or an instant and use the fakes. Every test file starts with `// covers FR-xxx`.

### `@mt/core` (`packages/core/src`)

| Area | File | Traces to |
|---|---|---|
| Error model, 17 codes with HTTP status | `errors.ts` | FR-144, 04 |
| Money helpers, `centsToReais` | `money.ts` | NFR-041, 08 section 3 |
| Order total | `order-total.ts` | FR-030..FR-039, ADR-006 |
| Status machine, history entry | `order-status.ts` | FR-021..FR-029, ADR-017 |
| Business hours, `nextOpening`, `localDay`, `localParts` | `business-hours.ts` | FR-083, FR-096, FR-113 |
| Service window decision | `service-window.ts` | FR-117, ADR-014 |
| Automatic messages, renderer | `automatic-messages.ts` | FR-110..FR-115, ADR-015 |
| Report aggregations | `reports.ts` | FR-070..FR-078, ADR-015 |
| Webhook signing and verification (3 headers) | `webhook-signature.ts` | FR-102, FR-103, FR-126, FR-147, NFR-012 |
| Retry schedule, failure classifiers | `retry-schedule.ts` | FR-108, FR-137, ADR-017 |
| API keys, base62 secrets | `api-keys.ts` | FR-088, FR-089, FR-140, ADR-009 |
| SSRF host and URL checks | `ssrf.ts` | FR-148, NFR-014 |
| `EnvelopeSecretBox`, `FakeSecretBox`, `parseKek` | `secret-box.ts` | NFR-010, ADR-012 |
| CPF, CNPJ, CEP, UF, IBGE, phone E.164 | `br-documents.ts` | FR-034, FR-045, FR-047 |
| backend-uatis payload mapping | `uatis-mapping.ts` | FR-104..FR-106, ADR-002 Amendment 1 |
| Fiscal mapping and pre-checks V1..V14 | `fiscal/invoice-request.ts` | FR-120..FR-125, 08 |
| web-nf error and status mapping | `fiscal/error-mapping.ts` | FR-127, FR-128, FR-131, 08 section 8 |
| Ports | `ports/*.ts` | FR-100, FR-150, NFR-061 |
| `NullBillingProvider`, `RecordingBillingProvider` | `billing/billing-providers.ts` | FR-150..FR-156 |
| `FakeGateway`, `FakeInvoiceGateway`, `FakeWebhookSender`, `FixedClock` | `fakes/*.ts` | FR-100, FR-116, FR-124 |
| Contract suites for each port | `contracts/*.contract.ts` (subpath `@mt/core/contracts`) | FR-100, FR-124, NFR-010 |

The planned test paths from 10.testing.md exist: `order-total.test.ts`, `order-status.test.ts`, `business-hours.test.ts`, `webhook-signature.test.ts`, `automatic-messages.test.ts`, `service-window.test.ts`, `reports.test.ts`.

### `@mt/schemas` (`packages/schemas/src`)

Zod schemas for every request in 06 and the Appendix A actions: orders (create body, patch, list query, create action, status actions), customers (create, patch, list, create and update actions), messages, menu (save, availability, delete, list query), stock (save item, movement, list), settings (profile, order preferences with timezone, business hours, automatic messages), integrations (WhatsApp, webhook endpoint, API keys, fiscal config), invoices (issue, cancel, refs), reports, the error envelope, queue wire shapes, and the outbound webhook envelope. Also `parseOrThrow` and `zodErrorToDetails` (422 with body-relative paths such as `items[0].qty`), and CPF, CNPJ, CEP, UF, IBGE, and phone field validators.

## What was verified

* `bun run typecheck`: 9 of 9 tasks green. `noUncheckedIndexedAccess` stays on in `@mt/config`.
* `bun test packages/core packages/schemas`: 472 pass, 0 fail, 31 files, about 100 ms.
* `biome check` is clean on both packages (formatted with the repo `biome.json`, so double quotes and semicolons).
* A test in `packages/core/src/index.test.ts` scans the non-test sources and fails on any `@mt/*`, database, HTTP framework, or filesystem import.
* The status table test runs all 49 `(from, to)` pairs for delivery and for pickup against the table written out by hand from 05.
* The signature vector is `t=1760356800,v1=7d06...11b6` over `{"hello":"world"}`. A Python `hmac` run produced it, and a second test compares against Node `crypto` for other bodies.
* Not verified: no database, no network, no real adapter. The DB trigger agreement test (every status triple) belongs to the integration layer. `canTransition` and `allowedTargets` are ready for it.

## Spec changes (docs edited first)

1. **04, port methods.** Added what the flows need: `WhatsAppGateway.sendTemplate`, `listApprovedTemplates`, `testConnection`; `InvoiceGateway.testConnection` and a third `idempotencyKey` argument on `cancelInvoice` (08 section 6.2 already asks for a new key per cancel); `SecretBox.seal/open` take the AAD context and return `kekVersion` and `last4`; `BillingProvider` and `WebhookSender` shapes written out. Added the `GatewayError` note, the contracts subpath, and "money in core is a safe-integer number".
2. **04, queue table.** Aligned with 05: `mt_invoice_jobs` has `op` = `issue | poll | cancel`, and `mt_sync` has `op: 'whatsapp_reconcile'` only. The flow text now says the invoice poll goes through `mt_invoice_jobs`. Key order matches 05. 06 got the same one-line fix.
3. **08, `reference`.** 06 and the OpenAPI file say `reference` is `order_invoices.id`; 08 said the order code. I followed 06. It lets the webhook route find the row before `external_id` is stored. The order code stays in `informacoes_adicionais`. `buildInvoiceRequest` takes `options.reference` and falls back to the order code.
4. **08, buyer address.** The destination address comes from the order columns first, then the customer columns, field by field. The order carries the address typed for this delivery (05: copied from the customer and editable). The old text read only the customer.
5. **08, signature and money.** `buildInvoiceRequest(order, items, customer, fiscalConfig, menuItems, kind, options?)`. `centsToReais` takes `number | bigint`. An NFe payment is always `valor = total` (the NFe body has no `troco`). V5 lists the address fields and the per-field rule.

## Decisions on ambiguous points

* **Cents are `number`, not `bigint`, in core.** JSON, Zod, and `Intl` do not take `bigint` well. `assertCents` guards safe integers. `packages/db` converts at the edge.
* **`canTransition(x, x)` is false.** The same status is a no-op, handled by `applyTransition` (`{ kind: 'noop' }`, no history). A pickup order in `saiu` (an impossible state) has no moves.
* **Service window is inclusive at 24 hours.** "Older than 24 hours" is outside (04, FR-117), so exactly 24 hours is inside. No inbound message ever counts as outside.
* **`closed` beats `welcome`** (04). If `closed` is disabled or throttled on a new conversation, `welcome` still goes out. The 12-hour check is `now - closedNoticeSentAt >= 12 h`.
* **Reports.** The period is inclusive local days (`fromDay`, `toDay`). Average ticket is half-up integer division. Top items group by snapshot name, tie-break by pt-BR collation, limit 8. Growth has one decimal and is `null` when the previous month is zero. I did not build the board KPIs of FR-025 (the "current day" scope for in-progress counts is open); T4.4 owns them.
* **Order total.** Unknown or foreign item ids are `item_unavailable` (same code as unavailable, no existence leak). Empty cart, bad quantity, and missing size are `validation_failed`. Every bad line is reported, with `items[i].field` paths.
* **Inbound unknown state** maps to `status: null`; callers keep the stored status. Inbound non-text uses `[mídia não suportada]` (ADR-002 Amendment 1, 05), not the `[imagem]` example in 06.
* **Address on orders.** The API body cannot require `logradouro` and `bairro` because 06 copies omitted parts from the customer. `assertDeliveryAddress` runs after the copy. The dashboard action schema checks it directly.
* **Fiscal.** A meal falls back to the built-in NCM 21069090 and CFOP 5101; a drink falls back to CFOP 5102 and has no built-in NCM (V3). `cidade` is required for a delivery address because web-nf needs `municipio`. A malformed menu override is a problem, not a silent fallback to the default.
* **Zod 3** (`^3.24.1`, same range as the dashboard), using calls that also exist in zod 4.
* **Schema strictness.** API bodies are `.strict()` (the client cannot send `source`, totals, or status). Server Action inputs strip unknown keys.
* **Secret edit forms.** `makeConnectWhatsAppSchema` requires both secrets; `makeUpdateWhatsAppSchema` and `makeUpdateFiscalConfigSchema` let them be omitted to keep the stored ones. URL schemas are factories that take `allowPrivateHosts`.
* **NullBillingProvider** takes injected `loadPlan` and `writeUsage` functions, so core reads no table.

## Remaining work and risks

* **T3.12 (coverage script) is not done.** It lives in `scripts/`, outside this task's paths. Every test file has a `// covers` header, so the script can read them.
* `bun install` rewrote `bun.lock` (new `zod` and `@mt/core` dependencies in `packages/schemas`). `packages/core/package.json` gained the `./contracts` export.
* Files in core and schemas use double quotes and semicolons (Biome defaults). `packages/db` and `apps/api` use single quotes. Run `bun run format` once at the end so the repo agrees.
* SSRF code decides on IP literals and names only. The http package must still resolve DNS and call `isBlockedAddress` on every address, and pin the connection (07).
* The fake `FakeInvoiceGateway` and `FakeGateway` mirror documented behavior of the real services. The real adapters must pass the same contract suites in P5 and P6.
