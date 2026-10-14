# P4a — Auth and service foundation

Covers T4.1 (Supabase Auth, `/login`, logout, proxy, session to restaurant),
T4.2 (service layer base: context, role guard, errors), T4.3 (nav by role,
logout), and the route split from ADR-004. Screens still render mock data.
T4.4–T4.12 wire them.

## What was done

### `@mt/http` (`packages/http`)

| Area | File | Traces to |
|---|---|---|
| Server config from env, never throws, never echoes values | `src/config.ts` | 04 "Configuration", ADR-012, ADR-017 |
| Deps container: db, `EnvelopeSecretBox`, clock, gateway factory (fakes by `MT_UATIS_FAKE` / `MT_WEBNF_FAKE`) | `src/deps.ts` | 04 "Ports and adapters", ADR-017 |
| Request context: user, api_key, or system actor | `src/context.ts` | ADR-005, 05 "Service context" |
| Role guard | `src/auth/roles.ts` | FR-005, FR-006 |
| Session to restaurant: `listMemberships`, `loadMembership`, `resolveUserContext` | `src/auth/membership.ts` | FR-004, FR-008, ADR-004 |
| `mapError` (HTTP envelope), `toActionError` (pt-BR action result) | `src/errors.ts` | FR-144, NFR-011 |
| `defineService`: role, then input, then `withRestaurantContext` | `src/service.ts` | FR-006, NFR-002 |
| Reference service: `getRestaurantProfile`, `updateRestaurantProfile` | `src/services/restaurant-profile.ts` | FR-080 |
| Test deps and context helpers | `src/testing/index.ts` (`@mt/http/testing`) | 10.testing.md |
| Pattern guide for later agents | `README.md` | — |

### Dashboard (`apps/dashboard`)

| Area | File | Traces to |
|---|---|---|
| Proxy: refresh session cookie, redirect to `/login`, `/login` to `/mensagens` when signed in | `proxy.ts` | FR-003 |
| Login page and form (pt-BR, Marmitop brand, shadcn/ui) | `app/login/page.tsx`, `components/login-form.tsx` | FR-001 |
| `loginAction`, `logoutAction` (one message for wrong user or password) | `lib/auth-actions.ts` | FR-001, FR-002 |
| Server deps singleton on `globalThis` | `lib/server/deps.ts` | ADR-004 |
| Env gate at request time (`connection()`) | `lib/server/env-gate.ts` | web-nf pattern |
| Session: verified user, then context from `restaurant_members`; `requireScreen` gives 404 to a role that cannot open a screen | `lib/server/session.ts` | FR-005, FR-008 |
| Action wrapper: `memberAction`, `adminAction`, `{ ok, data } \| { ok: false, error }` | `lib/server/action-core.ts`, `lib/server/safe-action.ts` | Appendix A, FR-006, FR-008 |
| Example actions | `app/(app)/configuracoes/actions.ts` | FR-080 |
| Routes and roles in one table | `lib/nav.ts` | FR-005, FR-007 |
| `(app)` layout: env gate, session, membership, nav | `app/(app)/layout.tsx` | ADR-004 |
| Eight routes, each rendering the existing screen | `app/(app)/*/page.tsx`, `components/messages-screen.tsx` | ADR-004 |
| Nav sidebar: links, items by role, logout | `components/nav-sidebar.tsx` | FR-002, FR-007 |
| Realtime hook `useRealtimeTable(table, restaurantId, onChange)` | `lib/realtime.ts` | ADR-004 |

`/` redirects to `/mensagens`.

## Decisions

* **Own action wrapper, not next-safe-action.** Appendix A fixes the result as
  `{ ok: true, data } | { ok: false, error }`. next-safe-action returns
  `{ data, serverError, validationErrors }`. The wrapper is 60 lines, unit
  tested, and rethrows Next control flow with `unstable_rethrow`.
* **Every service transaction sets `role app_service`.** Deployments connect as
  `app_service`, so this is a no-op there. If `DATABASE_URL` ever names a
  stronger role, RLS still applies. Tests connect as the owner and rely on it.
* **Admin-only screens answer 404 to an attendant**, as the brief asked. The
  nav hides them as well.
* **`MT_KEK_VERSION`** added to 04 and 07. Rotation increments `kek_version`
  (07), so the current key's version cannot be a constant. Default 1.
* **Real gateways are not built yet.** Without the fake flags,
  `deps.gateways.whatsapp()` and `.invoices()` throw a message that names
  P5 and P6.
* **v1 takes the oldest membership** (ADR-005: one restaurant per user).

## Verification

Run on 2026-10-14, after P2.1 (7c222ce).

| Check | Result |
|---|---|
| `bun run typecheck` | 9 of 9 tasks pass |
| `packages/http` unit tests (config, deps, errors, roles, `defineService`) | 22 pass, 0 fail |
| `apps/dashboard` unit tests (`lib/nav.test.ts`, `lib/server/action-core.test.ts`) | 14 pass, 0 fail |
| `bun run --cwd apps/dashboard build` | passes. Every `(app)` route and `/login` is `ƒ` (dynamic); `/` is a redirect; proxy registered |

### Pending: the local stack was down

The Docker daemon hung during this phase, so the Supabase stack (Postgres,
Auth) did not answer. These checks are written but not yet run:

* `packages/http/src/auth/membership.integration.test.ts` (6 tests): the
  caller's restaurant and role come from `restaurant_members`; a foreign
  restaurant gives null; a user with no membership gives null.
* `packages/http/src/services/restaurant-profile.integration.test.ts`
  (8 tests): admin reads and writes; attendant gets `forbidden`; invalid input
  gives `validation_failed` with paths; a forged `admin` role in the context
  still cannot write (RLS reads the role from data); restaurant B stays
  unchanged.
* Browser walk on `http://localhost:3100` with the seeded users
  (`admin@marmitadacasa.test`, `atendente@marmitadacasa.test`, password in
  `scripts/dev-seed/constants.ts`):
  1. signed out, `/pedidos` redirects to `/login`;
  2. admin logs in, lands on `/mensagens`, the nav shows eight items;
  3. attendant logs in, the nav shows four items, `/cardapio` returns 404;
  4. logout returns to `/login`, and `/mensagens` redirects to `/login` again.

To run them: restart Docker, `bun run dev:stack`, `bun test` in
`packages/http`, then the walk above.
