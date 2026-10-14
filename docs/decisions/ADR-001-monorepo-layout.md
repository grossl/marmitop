# ADR-001 — Monorepo layout

**Status:** accepted · 2026-10-13

## Question

The project is one Next.js app at the repository root. The goal fixes the stack: Turborepo with Bun workspaces, Next.js, Hono, and Supabase. It also says to follow the structure of `web-nf`. Which apps and packages do we create, and where does the current UI go?

## Options

1. **Copy the web-nf shape exactly:** `apps/dashboard`, `apps/api`, `apps/generation-api`, `apps/worker`.
2. **Use the web-nf shape without `generation-api`:** `apps/dashboard`, `apps/api`, `apps/worker`.
3. **Keep one Next.js app** and put API routes and jobs inside it.

## Tradeoffs

In web-nf, `generation-api` exists because invoice intake is a high-volume hot path with its own scaling needs. Marmitop has no such path. Its external HTTP surface is small: inbound webhooks from `backend-uatis` and `web-nf`, and a small public API for integrators. A fourth app adds a deploy target, an env file, and a port, and buys nothing. Option 3 breaks the fixed stack, because Hono and a separate worker are required.

## Recommendation and choice

Option 2. The current UI moves to `apps/dashboard` without visual change. The package scope is `@mt/*`.

| Path | Role |
|---|---|
| `apps/dashboard` | Next.js 16 App Router, Turbopack, shadcn/ui. The current UI, now on real data. |
| `apps/api` | Hono. Public API (API key) and inbound webhooks (`backend-uatis`, `web-nf`). |
| `apps/worker` | Bun process. Consumes pgmq queues: outbound messages, outbound webhooks, invoice jobs, reconciliation polls. |
| `packages/core` | Domain logic with zero I/O: order totals, status machine, business hours, automatic-message rules, webhook signing, ports. |
| `packages/db` | postgres.js client, RLS context wrapper, row types, queue helpers. |
| `packages/schemas` | Zod schemas shared by the API, the dashboard, and the worker. |
| `packages/http` | Services (one function per use case) that `apps/api` and the dashboard both call. |
| `packages/ui` | shadcn/ui components moved from `components/ui`. |
| `packages/config` | `tsconfig.base.json` and the Biome config. |
| `supabase/` | `config.toml`, numbered migrations, `seed.sql`. |
| `scripts/` | Local stack bootstrap and seed. |

Local ports do not collide with the sibling projects, which use 3000–3002, 5532x, and 5632x:

| Service | Port |
|---|---|
| dashboard | 3100 |
| api | 3101 |
| worker health | 8181 |
| Supabase API / DB / Studio | 54421 / 54422 / 54423 |

Rule from web-nf: an app never imports another app. Shared code goes to `packages/*`.

## Consequences

* `.claude/launch.json` points at `apps/dashboard` on port 3100.
* pnpm is replaced by Bun. `pnpm-lock.yaml` is deleted.
* The product name is **Marmitop**. The UI brand "MarmitaChat" changes to "Marmitop".
