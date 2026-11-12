# ADR-043 — Two branches: main and develop

**Status:** accepted · 2026-11-12 · supersedes ADR-011

## Question

ADR-011 kept all v1 work on `feat/v1-platform` and planned one pull request into `master`. v1 is now on `master`. The sibling `backend-uatis` uses `main` for production and `develop` for staging. Which branches does Marmitop use?

## Options

1. **Keep `master` and `feat/v1-platform`.** No change. The names differ from `backend-uatis`, and `feat/v1-platform` no longer describes the work.
2. **`main` and `develop`, as in `backend-uatis`.** One model for both repositories.

## Choice

Option 2.

* `main` is the default branch and holds what runs in production.
* `develop` is the integration branch. Work lands there first, and each milestone is committed and pushed there (CLAUDE.md rule 6).
* A larger change starts on a short branch from `develop` (`feat/…`, `fix/…`) and merges back into `develop`.
* A release merges `develop` into `main`.
* `master` and `feat/v1-platform` are deleted. Both pointed at the same commit as `main` and `develop`, so no history is lost.

## Consequences

* CI runs on pushes to `main`, `develop`, `feat/**`, and `fix/**`, and on every pull request.
* The Vercel production branch is `main`. Fly deploys stay manual (11.operations.md).
