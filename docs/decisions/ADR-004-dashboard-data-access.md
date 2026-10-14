# ADR-004 — Dashboard data access and live updates

**Status:** accepted · 2026-10-13

## Question

How does the dashboard read and write data, and how does it receive live updates for messages and the orders board?

## Options

1. Dashboard calls `apps/api` over HTTP.
2. Dashboard calls `@mt/http` services in process, through Server Components and Server Actions. This is web-nf ADR-013.
3. Browser talks to Supabase directly for everything (PostgREST plus RLS).

## Tradeoffs

Option 1 adds a network hop and duplicated types. Option 3 puts business rules (order total, status transitions) in the browser or in SQL. Option 2 keeps one implementation of each rule. Its cost is that the dashboard server holds `DATABASE_URL` and `MT_KEK`.

## Recommendation and choice

Option 2 for reads and writes. Live updates use **Supabase Realtime** `postgres_changes` on `orders`, `messages`, and `conversations`. The browser subscribes with the user's session, and RLS filters the events. On an event, the client refreshes the affected data through a Server Action.

The screens keep their current components. State-based navigation becomes App Router routes: `/mensagens`, `/pedidos`, `/novo-pedido`, `/contatos`, `/cardapio`, `/estoque`, `/relatorios`, `/configuracoes`, plus `/login`.

## Consequences

* Every Server Action resolves the caller's restaurant and role from `restaurant_members`. It never uses ids that the client sends.
* `orders`, `messages`, and `conversations` are added to the `supabase_realtime` publication.
