# eval:ai

Runs the 25 golden pt-BR conversations in `cases.ts` against the real model (FR-199). It grades the
final state (order, items, pause reason), not the wording. It uses the integration-test database and
truncates it. It spends money: about US$ 0.05 for the full set on `claude-haiku-5-5` (an estimate).

It is not part of `bun run test`. The files here do not match `*.test.ts`.

    ANTHROPIC_API_KEY=… bun run --cwd apps/worker eval:ai
    ANTHROPIC_API_KEY=… MT_AI_MODEL=claude-sonnet-5-5 bun run --cwd apps/worker eval:ai
    ANTHROPIC_API_KEY=… bun run --cwd apps/worker eval:ai --case "audio"

Dry run: `bun run --cwd apps/worker eval:ai --dry` runs one case, "pickup, one item with size", with a
scripted model. It needs no key and no network. It checks the seeding, the turn loop, and the grading.
Without `--dry` and without `ANTHROPIC_API_KEY`, the command exits with code 2.

Grading ignores the fixture's own order, cart, and messages. The runner deletes the seeded messages
and counts only orders linked to this case's AI runs.

The P10 exit gate is a pass rate of at least 90% with zero orders created without confirmation.
