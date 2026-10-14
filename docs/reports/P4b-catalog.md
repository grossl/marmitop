# P4b report: catalog (menu and stock)

Covers FR-050 to FR-069. Admin only screens: Cardápio and Estoque.

## Done

* Schemas (`packages/schemas/src/menu.ts`, `stock.ts`): added `listMenuItemsSchema`, `archiveStockItemSchema`, `listStockMovementsSchema`.
* Services in `packages/http/src/services/catalog/`:
  * `menu.ts`: `listMenuItems` (admin or attendant), `saveMenuItem`, `archiveMenuItem`, `setMenuItemAvailability` (admin).
  * `stock.ts`: `listStockItems` (items, `lowCount`, `totalValueCents`), `saveStockItem`, `archiveStockItem`, `recordStockMovement`, `listStockMovements` (admin).
  * Sizes are replaced on each save (no row references a size). `position` is the array index.
  * `current_qty` is never written by a service. The opening quantity is an `in` movement ("Saldo inicial").
  * An `out` or `adjust` below zero throws `validation_failed` with a `qty` field error before the DB check.
* Server Actions: `app/(app)/cardapio/actions.ts` (`listMenuAction`, `saveMenuItemAction`, `deleteMenuItemAction`, `setMenuItemAvailabilityAction`) and `app/(app)/estoque/actions.ts` (`listStockItemsAction`, `saveStockItemAction`, `archiveStockItemAction`, `recordStockMovementAction`, `listStockMovementsAction`).
* UI: `cardapio-page.tsx` and `stock-page.tsx` read props from the Server Component and call actions. Toasts show errors. Layout kept; additions: category select, available and popular switches, optional image field, collapsible "Fiscal" section (NCM, CFOP), availability switch in the detail panel, stock movement dialog (in, out, adjust), history sheet, edit and archive buttons.
* Image upload: browser Supabase client, bucket `menu-images`, path `{restaurant_id}/menu/{item_id}/{uuid}.{ext}`, 2 MB and JPEG/PNG/WebP checked in the browser (ADR-017 exception).
* Pure helpers with unit tests: `cardapio/menu-helpers.ts`, `estoque/stock-helpers.ts`.

## Verified

* `bun run typecheck`: no errors in catalog files (other agents' screens had open errors at the time).
* Unit tests: schemas (109 pass), helpers (8 pass).
* Biome check clean on services, actions, helpers, schema files.

## Pending

* Integration tests `menu.integration.test.ts` and `stock.integration.test.ts` are written but not run (Docker down).
* `bun run --cwd apps/dashboard build`: Turbopack compile passed; the type check step failed only on other agents' unfinished pages (`contatos`, `mensagens`, `pedidos`). Re-run when they land.
* Browser check of both screens and the image upload against the local stack.

## Risks

* `delete from menu_item_sizes` then insert needs the admin delete grant (present in 0006). If a later table references sizes, switch to a diff.
* Image upload cannot run until the stack and bucket exist. A failed upload blocks the save with a toast.
* The Realtime publication has no menu or stock tables, so those screens refresh after the user's own actions only (no FR needs live updates).
* No DB change needed.
