# P4b report: messaging (messages and contacts)

## Done

Services in `packages/http/src/services/messaging/`:

* `conversations.ts`: `listConversations`, `getConversation` (marks read, returns messages, window state, the customer's orders), `markConversationRead`, `sendMessage`, `retryMessage`.
* `customers.ts`: `listCustomers`, `getCustomer`, `createCustomer`, `updateCustomer`. No delete.
* `ingest-inbound.ts`: `ingestInboundMessage(tx, restaurantId, input)`. Upserts customer and conversation, inserts the inbound message idempotently on `external_id`, updates preview, unread, `last_inbound_at`. P5's webhook and poll reuse it. It sends no automatic messages.
* `simulate-inbound.ts`: `simulateInboundMessage` (admin, refused when `deps.env === "production"`). The call site carries `// P5: automatic messages`.
* `customer-orders.ts`, `helpers.ts`: shared read model and pure helpers.

Schemas added (`messages.ts`, `customers.ts` only): `listConversationsActionSchema`, `conversationIdActionSchema`, `retryMessageActionSchema`, `simulateInboundActionSchema`, `customerIdActionSchema`, `listCustomersActionSchema`.

Dashboard: `mensagens/{page,actions}`, `contatos/{page,actions}`, `messages-screen`, `chat-panel`, `contacts-sidebar`, `contacts-page`, new `customer-orders-panel`, `simulate-inbound-form`, `messaging-format` (+ test).

Behavior:

* `sendMessage`: checks the 24-hour window (`assertFreeTextAllowed`), then inserts a `pending` `out` row, updates the conversation preview, and calls `sendJob(QUEUES.outboundMessages)` in the same transaction. A closed window stores nothing. The composer shows "Fora da janela de 24h".
* `retryMessage`: `failed` goes back to `pending` and the job is enqueued again. It re-checks the window.
* Realtime: `useRealtimeTable` on `messages` and `conversations` calls a debounced `router.refresh()`.
* The `Pedido #ORD-001` tag shows the order code; clicking it highlights the order in the right panel. "Criar pedido" links to `/novo-pedido?conversation=<id>&customer=<id>`.
* Contacts: server-side search by name, phone, or bairro (`?q=`), sheet through `?id=`, create and edit dialog with the structured address. CPF/CNPJ and phone validation come from the schemas (`@mt/core` br-documents). A duplicate phone returns `validation_failed` on field `phone`.

## Verified

* `bun run typecheck`: pass.
* `bun run --cwd apps/dashboard build`: pass.
* Unit tests: `helpers.test.ts`, `messaging-format.test.ts`, schemas: pass.

## Pending

* `messaging.integration.test.ts` (covers FR-010..019, FR-040..049, FR-117, NFR-001) is written and typechecks. It has not run: Docker is down. Expect small fixes (the order status chain in the totals test depends on the transition trigger; pgmq table name `pgmq.q_mt_outbound_messages`).
* No schema unit tests for the six new schemas (the task allowed only `messages.ts` and `customers.ts`).
* No browser check of the UI against a live stack.

## Decisions and risks

* Totals: `ordersCount` skips `cancelado` (FR-044); `totalSpentCents` counts `entregue` only (ADR-015, task brief). FR-044 says "excludes cancelado" for both. Reconcile the spec text.
* FR-018 "move an order to the next status" is not built in the chat panel. The panel lists orders and links to `/pedidos`. It needs the orders agent's `changeOrderStatus` action.
* Appendix A lists `simulateInboundMessage` with `MT_ENV=development`. The UI gate is `NODE_ENV !== "production"` and admin; the service gate is `deps.env !== "production"`.
* The 24-hour window is computed on the server when the page loads. A window that closes while the page stays open shows up on the next refresh, and the service refuses the send anyway.
* `whatsapp_not_configured` (06.api-spec `POST /v1/messages`) is not checked in `sendMessage`: P5 owns the integration state.
* Contacts list loads the first 100 customers; search narrows. No pager yet (`nextCursor` is returned).
* Timestamps render in a fixed `America/Sao_Paulo` zone (the settings default), not the per-restaurant `timezone`.
* No DB change needed.
