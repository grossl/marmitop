# Goal — Build Restaurant SaS

## Mission

Build a SaaS platform that will be used for the restaurant managers to manage all operation like the sales, finantial, comunication, orders, stocks, our system will use the backend-uatis for the comunication using the whatsapp api, and the web-nf to send and comunication with the tax authority about the invoices, we gonna use the supabase as the storage database, so follow the same strucutre of the web-nf using the existing UI structure in the project.

## Operating rules (read before any work)

1. Invoke the using-superpowers skill first. Use it to manage the development workflow and the life cycle of every sub-agent.
2. Run as the chief agent under the fable-chief-agent skill. You own intent, architecture, decomposition, tradeoffs, review, and final approval. Delegate discovery, implementation, tests, and verification to cheaper agents. Route high-risk work (auth, billing, keys, certificates, migrations, queues, public API) through Opus-level agents for execution or review.
3. Write every document with the technical-writer skill. Follow Orwell's six rules and the ASD-STE100 baseline: short sentences, active voice, one term per concept, no jargon without a definition. Do not simplify code, commands, identifiers, or legal terms.
4. Follow spec-driven development. Write the spec, then implement. Code must trace back to a spec. When reality forces a change, update the spec first.
5. Run autonomously. Do not stop to ask for my approval. When you face an open question or a fork in the road, write an ADR: state the question, the options, the tradeoffs, your recommendation, and the path you chose. Then continue. You have authority to weigh, recommend, and choose the best path without my intervention.
6. Commit and push at every milestone. A milestone is a completed document, a completed feature, or a green test suite after a meaningful change. Write clear commit messages that name the milestone and reference the spec or ADR it traces to (for example, `feat(worker): MT signing per 04.architecture.md, ADR-007`). Never leave a finished milestone unpushed.

## Documentation

Save all documents in `/docs`, numbered in order of execution:

* `01.briefing.md` — Problem, users, goals, success criteria, out of scope.
* `02.requirements.md` — Functional and non-functional requirements, numbered (FR-001, NFR-001) so tasks and tests can reference them.
* `03.domain-research.md` — How NFe and NFSe work. Cover SEFAZ web services, XML layouts, digital signature (A1 e-CNPJ), homologação vs. produção, the NFSe Nacional standard, ABRASF, and how municipalities differ. Primary source — read it, and cite it in a References section: https://www.nfe.fazenda.gov.br/portal/listaSubMenu.aspx?Id=04BIflQt1aY= NFSe references (municipality provider example — Publica/Irani):
   * Manual: https://s3-sa-east-1.amazonaws.com/publica-downloads/tmi/arquivos/manual_nfse_versao_01.pdf
   * Portal: https://nfse1.publica.inf.br/irani_nfse/index.jsp
   * Downloads (schemas, WSDL): https://nfse1.publica.inf.br/irani_nfse/jsp/externo/downloads.jsp Use this provider as one of the two municipality sandboxes in the definition of done.
* `04.architecture.md` — Services, packages, data flow, queue design, and the diagrams to support them.
* `05.data-model.md` — Tables, relations, RLS policies, storage buckets, queue tables.
* `06.api-spec.md` — Endpoints, request and response schemas, error codes, idempotency, rate limits, webhook payloads and signatures. Produce an OpenAPI file next to it.
* `07.security.md` — Certificate storage, API key design, webhook signing, secrets, RLS, audit.
* `08.validation-templates.md` — The municipality template system (see Backoffice below).
* `09.plan.md` — Milestones, task breakdown, dependencies, and which agent tier executes each task.
* `10.testing.md` — Test strategy, including how to test against SEFAZ homologação and municipality sandboxes.
* `11.operations.md` — Deploy targets, environments, migrations, observability, runbooks.

Record every significant decision and every open question as an ADR in `/docs/decisions/`, numbered the same way. Each ADR states the question, the options considered, the tradeoffs, the recommendation, and the chosen path. This folder replaces approval checkpoints: it is where I review what you decided and why.

The list above is the baseline, not a cage. Create extra documents or split a document when it grows past one clear subject. Keep the numbered order-of-execution scheme: insert new numbers where the work happens (for example, `06a.webhook-spec.md` or renumber cleanly) and record the restructure as an ADR.

## Stack (fixed — do not substitute)

* Monorepo: Turborepo with Bun workspaces. Use Bun as package manager and script runner; use its test runner where it fits.
* Web app: latest stable Next.js (App Router, Turbopack).
* UI: shadcn/ui, Use the existing UI in the project to start
* API: Hono.
* Backend: Supabase (Postgres, Auth, Storage, RLS).
* Billing: No third-party payment provider for now. Build the screens and flows — usage metering, plan display, invoice history placeholder — behind a billing interface so a provider can plug in later without changes to the callers.

Propose the monorepo layout in `04.architecture.md`. Expected shape: `apps/dashboard`, `apps/api` (management), `apps/generation-api`, `apps/worker`, plus shared packages for database types, validation schemas, and UI.

## Product scope (v1)

### Web platform (`apps/dashboard`)
* Login and logout; roles `admin` (everything) and `attendant` (messages, orders, new order, contacts).
* Messages: WhatsApp conversations list with search, unread counts and last-message preview; send text replies; live updates.
* Orders board: Kanban by status (`aguardando` → `confirmado` → `preparando` → `pronto` → `saiu` → `entregue`, plus `cancelado`), drag to change status, search, and daily KPIs (delivered revenue, in progress, ready, out for delivery).
* New order (counter/phone): pick customer, items and sizes, delivery or pickup, address, payment method, notes; total computed by the server.
* Contacts: list with search, detail sheet with order history, total orders and total spent; create and edit customers.
* Menu: CRUD for meals (category, sizes with prices, calories, availability, popular flag, available weekdays) and drinks (category, volume, price, availability, weekdays).
* Stock: items with unit, category, current and minimum quantity, unit cost; in/out adjustments recorded as movements; low-stock alerts and total stock value.
* Reports: revenue, order count, average ticket and active customers; monthly revenue (last 6 months), orders per day (last 14 days), top-selling items.
* Settings: restaurant profile, order preferences (auto-accept, pickup, delivery estimate), business hours, automatic messages, WhatsApp connection, outbound webhook URL and API key.
* Finance (admin/manager): list of all paid orders with filters by customer and by date range, totals for the filtered set, the invoice status of each order, and issuing invoices to the tax authority (one order or a selected batch) through web-nf.

### WhatsApp channel

* Lets use the backend-uatis local project api, so check how the project work to implement.
* WhatsApp Business Cloud API: inbound webhook with signature verification, outbound text messages, delivery/read status.
* Automatic messages: welcome (first contact), closed (outside business hours), order received (on order creation).
* Messages can be linked to an order (the `Pedido #ORD-001` tag in the chat).

### NFe comunication

* Lets use the web-nf Project local project, so check how the project work to implement.
* the order can be able to generate the NF using the web-nf project to generate that
* we need be able to send and check the result and the xml and pdf of the invoice in the order


## Definition of done (v1)

1. This scope document and the data model doc exist and match the built system.
2. A restaurant can: log in → configure profile, hours and automatic messages → connect a WhatsApp number → register menu items → receive a customer message → reply from the dashboard → create the order from the chat → move it through the board until `entregue` → see it in reports.
3. A counter/phone order can be created from New order with customer, items, sizes, delivery/pickup and payment, and appears on the board in real time.
4. Every dashboard screen reads and writes real data; no mock data from `lib/marmita-data.ts` remains in use.
5. Tests pass for order total calculation, status transitions and history, business-hours logic, WhatsApp webhook signature validation, automatic message triggers, report aggregations and outbound webhook signing.
6. Each phase ends with a short report saved in the docs: what was done, what was verified, and what risk remains.
