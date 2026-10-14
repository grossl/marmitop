# @mt/http

Services shared by `apps/dashboard`, `apps/api`, and `apps/worker`. One
service per use case. The dashboard calls them in process from Server
Components and Server Actions (ADR-004). The api calls them from Hono
handlers.

## Layout

```
src/
  config.ts        readServerConfig(env): DATABASE_URL, MT_KEK, MT_KEK_VERSION,
                   MT_KEK_PREVIOUS, MT_UATIS_FAKE, MT_WEBNF_FAKE, MT_ENV
  deps.ts          ServiceDeps and createServiceDeps(config, overrides)
  context.ts       ServiceContext: user, api_key, or system actor
  errors.ts        mapError (HTTP envelope), toActionError (Server Action result)
  service.ts       defineService: the service pattern
  auth/
    roles.ts       hasRole, requireRole
    membership.ts  listMemberships, loadMembership, resolveUserContext
  adapters/
    safe-fetch.ts     the only HTTP client for admin-entered URLs (SSRF guard, 10 s, no redirects)
    uatis-gateway.ts  UatisGateway, the WhatsAppGateway adapter over backend-uatis
    webhook-sender.ts SafeFetchWebhookSender, the WebhookSender adapter (signed POST)
  services/
    index.ts       re-exports one file per domain
    restaurant-profile.ts   the reference service
    whatsapp/      connection, automatic messages, gateway events, inbound webhook (P5)
    webhooks/      emitEvent (outbound events in the producer's transaction), worker loaders,
                   listWebhookDeliveries, redeliverWebhook (P7)
    billing/       recordUsage: usage_events rows (P7)
    public-api/    the snake_case use cases behind apps/api routes/public: API-key auth,
                   rate limit, idempotency, keyset cursor, orders, customers, menu, messages (P7)
  testing/         createTestServiceDeps, userCtx, FakeUatisServer, MemoryUatisInboundStore
                   (tests only: @mt/http/testing)
```

## The service pattern

A service is a function `(deps, ctx, input) => Promise<output>`. Build it with
`defineService`:

```ts
export const updateRestaurantProfile = defineService({
  name: "settings.saveProfile",   // domain.useCase, for logs and audit
  minRole: "admin",               // "attendant" means admin or attendant
  input: saveProfileSchema,       // a Zod schema from @mt/schemas
  run: async ({ tx, ctx, input, deps }) => {
    const [row] = await tx`update public.restaurants set ... where id = ${ctx.restaurantId} returning ...`;
    if (row === undefined) throw new AppError("forbidden", "...");
    return toProfile(row);
  },
});
```

`defineService` fixes the order of checks:

1. **Role.** `requireRole(ctx, minRole)` throws `forbidden`. This check is
   authoritative (ADR-005, FR-006). It touches no database.
2. **Input.** The Zod schema parses the input. A failure throws
   `validation_failed` with field paths (FR-144).
3. **Run.** `run` executes inside `withRestaurantContext`, so `mt.set_context`
   runs before the first statement and RLS applies (NFR-002).

RLS is the second line. `mt.actor_role()` reads the role from
`restaurant_members`, not from `ctx`. A context that claims `admin` for an
attendant passes step 1 and then matches zero rows. The service turns zero
rows into an `AppError`.

Rules:

* Read the restaurant from `ctx.restaurantId`. Never take a restaurant id,
  user id, or role from `input` (FR-008).
* Use `tx` for every query. Do not open a second transaction.
* Throw `AppError` for anything the caller can act on. Any other error becomes
  `internal_error`, and its message never reaches the caller (NFR-011).
* Money is integer cents (ADR-006).
* Reach the outside world through `deps`: `deps.clock`, `deps.secretBox`,
  `deps.gateways.whatsapp(conn)`, `deps.gateways.invoices(conn)`. Fakes are
  chosen by `MT_UATIS_FAKE` and `MT_WEBNF_FAKE` (ADR-017).

## Adding a domain

1. Create `src/services/<domain>.ts`, one `defineService` per use case named in
   06.api-spec.md Appendix A.
2. Export it from `src/services/index.ts`.
3. Write `src/services/<domain>.integration.test.ts` first. Use
   `createTestDb` and `seedRestaurant` from `@mt/db/test-harness`, and
   `createTestServiceDeps(db)` and `userCtx(...)` from `../testing`. Cover:
   the allowed role, a refused role, invalid input, and a second restaurant
   that stays untouched. Name the requirements: `// covers FR-0xx`.
4. In the dashboard, add a Server Action with `memberAction` or `adminAction`
   from `apps/dashboard/lib/server/safe-action.ts`. Pass the same schema. See
   `apps/dashboard/app/(app)/configuracoes/actions.ts`.

## Session to context

The dashboard gets the user id from the verified Supabase session.
`resolveUserContext(deps, userId)` calls `mt.memberships_for_user` (security
definer, no context yet), then re-reads the role inside the restaurant's
context. v1 takes the oldest membership (ADR-005). The api builds an
`ApiKeyContext` from `mt.api_key_lookup` with role `attendant` (ADR-017).

## Errors

* `mapError(e)` returns `{ status, code, body, unexpected }` for the HTTP
  envelope. Unique violations (`23505`) map to `conflict`, privilege errors
  (`42501`) to `forbidden`.
* `toActionError(e)` returns `{ code, message, fieldErrors? }`, with pt-BR
  copy per code. Server Actions return `{ ok: false, error }`.

## Tests

`bun test` runs unit tests and `*.integration.test.ts`. Integration tests need
the local stack (`bun run dev:stack`) or `TEST_DATABASE_URL`.
