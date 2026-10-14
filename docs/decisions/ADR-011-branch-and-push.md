# ADR-011 — Branch and push policy

**Status:** accepted · 2026-10-13

## Question

The goal says to commit and push at every milestone. The repository has one branch, `master`.

## Choice

All v1 work happens on `feat/v1-platform`. Each milestone is committed and pushed to `origin/feat/v1-platform`. A pull request into `master` opens when the definition of done is met. `master` then stays deployable, and the history is still reviewable milestone by milestone.
