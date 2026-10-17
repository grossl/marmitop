# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## What this is

**Marmitop** — restaurant operations SaaS for Brazilian marmita (meal box)
shops: WhatsApp conversations, orders board, menu, stock, reports, and invoices.
Turborepo + Bun workspaces monorepo (Bun 1.4.0 in `packageManager`). Stack:
Next.js 16 App Router, shadcn/ui, Hono, postgres.js on Supabase Postgres
(Auth/Storage/RLS), pgmq + pg_cron.

Integrations: WhatsApp through `backend-uatis`, invoices (NFC-e/NFe) through
`web-nf`. Both are sibling projects; read them, never modify them.

This repo is **spec-driven**: `docs/` is the source of truth (numbered docs and
ADRs in `docs/decisions/`). Code traces back to a spec, ADR, or requirement.
When reality forces a change, update the spec first. Tests name the
requirements they cover (`// covers FR-032, NFR-007`).

## Operating rules

Source: `.claude/goal.md`.

1. **Invoke the using-superpowers skill first.** Use it to manage the
   development workflow and the life cycle of every sub-agent.
2. **Run as chief agent under the fable-chief-agent skill.** The chief agent
   owns intent, architecture, decomposition, tradeoffs, review, and final
   approval. Delegate discovery, implementation, tests, and verification to
   cheaper agents. Route high-risk work (auth, billing, keys, migrations,
   queues, public API) through Opus-level agents.
3. **Write every document with the orwell-writing skill.** Short sentences,
   active voice, one term per concept. Do not simplify code, commands,
   identifiers, or legal terms.
4. **Spec-driven development.** Write the spec, then implement.
5. **Run autonomously.** On an open question, write an ADR (question, options,
   tradeoffs, recommendation, choice), then continue.
6. **Commit and push at every milestone** (completed doc, completed feature,
   green suite). Commit messages name the milestone and cite the spec or ADR,
   for example `feat(worker): ... per 04.architecture.md, ADR-007`.

**Stack is fixed — do not substitute:** Turborepo + Bun, Next.js App Router,
shadcn/ui, Hono, Supabase (Postgres/Auth/Storage/RLS), pgmq + pg_cron for
queues and scheduling (no Redis, no external queue).

**Hard constraints:** RLS isolation on every tenant table (`restaurant_id`) — no
cross-restaurant reads, ever. Never log secrets or API keys. Every outbound
webhook is HMAC-SHA256 signed, retried with backoff, and every attempt is
recorded. Every external dependency sits behind an injectable interface.
Untested code does not merge. Money is `bigint` cents.

## Commands

```bash
bun install
bun run typecheck   # turbo run typecheck (tsc --noEmit everywhere)
bun run test        # turbo run test (bun:test — not vitest/jest)
bun run build       # turbo run build (dashboard)
bun run format      # biome format --write .

# Dev servers — `bun run dev` runs every app via turbo; or one app:
bun run --cwd apps/dashboard dev   # :3100
bun run --cwd apps/api dev         # :3101
bun run --cwd apps/worker dev      # health :8181

# Single test
bun test packages/core/src/index.test.ts   # one file
bun test -t "health"                       # by test name
bun run --cwd packages/core test           # one workspace
```

Local ports (ADR-001): dashboard 3100, api 3101, worker health 8181, Supabase
API/DB/Studio 54421/54422/54423. Siblings: web-nf 3000–3002 + 8080, backend-uatis 3300–3301 (full map in ADR-001).

Test naming: `*.test.ts` (unit), `*.integration.test.ts` (needs a database).

## Architecture

- `apps/dashboard` (`@mt/dashboard`) — Next.js 16 UI, Turbopack, shadcn/ui.
- `apps/api` (`@mt/api`) — Hono. Public API (API key) and inbound webhooks
  (`backend-uatis`, `web-nf`). `GET /v1/health`.
- `apps/worker` (`@mt/worker`) — Bun process consuming pgmq queues. Health
  server on :8181.
- `packages/core` — domain logic with zero I/O: totals, status machine,
  business hours, ports.
- `packages/db` — postgres.js client, RLS context wrapper, row types.
- `packages/schemas` — Zod schemas shared by api, dashboard, worker.
- `packages/http` — services (one function per use case) shared by api and
  dashboard.
- `packages/ui` — shadcn/ui components. Import as `@mt/ui/components/button`;
  `cn` lives in `@mt/ui/lib/utils`. The dashboard `globals.css` `@source`s this
  package so Tailwind v4 generates its classes.
- `packages/config` — `tsconfig.base.json` (`@mt/config/tsconfig.base.json`).
- `supabase/` — `config.toml`, numbered migrations, `seed.sql`.

Boundary rule (ADR-001): apps never import other apps. Shared code moves down
into a package.

Order status: `aguardando → confirmado → preparando → pronto → saiu →
entregue`; any non-final status → `cancelado`. Pickup skips `saiu`.

## Docs

`docs/` holds, in order: `01.briefing`, `02.requirements`, `03.domain-research`,
`04.architecture`, `05.data-model`, `06.api-spec`, `07.security`,
`08.fiscal-mapping`, `09.plan`, `10.testing`, `11.operations`, `12.ai-order-assistant`. ADRs live in
`docs/decisions/ADR-NNN-*.md`. Read the matching doc before changing an area.

## Conventions

- Portuguese domain terms (status names, screen names, fiscal terms) stay
  verbatim. UI text is pt-BR. Product name is **Marmitop**.
- The dashboard `tsconfig` turns off `noUncheckedIndexedAccess` (legacy UI
  code); new packages keep it on via `@mt/config`.
- Do not re-enable `typescript.ignoreBuildErrors`.
