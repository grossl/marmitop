// packages/http/src/services/catalog/stock.ts
//
// Stock (FR-060..FR-069, Appendix A `listStockItems`, `saveStockItem`, `recordStockMovement`). Admin only.
// `current_qty` changes only through `stock_movements`; the DB trigger applies the delta and writes
// `balance_after`. This file never updates `current_qty`.

import { AppError } from "@mt/core";
import type { StockItemRow, StockMovementRow } from "@mt/db";
import {
  archiveStockItemSchema,
  listStockMovementsSchema,
  listStockQuerySchema,
  recordStockMovementSchema,
  saveStockItemSchema,
} from "@mt/schemas";

import { defineService } from "../../service";

export interface StockItemDto {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  readonly category: StockItemRow["category"];
  readonly currentQty: number;
  readonly minimumQty: number;
  readonly unitCostCents: number;
  /** `current_qty <= minimum_qty` (FR-064). */
  readonly low: boolean;
}

export interface StockList {
  readonly items: readonly StockItemDto[];
  /** Active items at or below their minimum, whatever the filter. */
  readonly lowCount: number;
  /** `sum(round(current_qty * unit_cost_cents))` over active items (FR-065). */
  readonly totalValueCents: number;
}

export interface StockMovementDto {
  readonly id: string;
  readonly kind: StockMovementRow["kind"];
  /** Signed for `adjust`. */
  readonly qty: number;
  readonly balanceAfter: number;
  readonly reason: string | null;
  readonly createdAt: string;
}

type ItemRow = Pick<
  StockItemRow,
  "id" | "name" | "unit" | "category" | "current_qty" | "minimum_qty" | "unit_cost_cents"
>;

const ITEM_COLUMNS = "id, name, unit, category, current_qty, minimum_qty, unit_cost_cents";

export function isLowStock(currentQty: number, minimumQty: number): boolean {
  return currentQty <= minimumQty;
}

/** `round(qty * cents)` with the same half-up rounding as Postgres `round(numeric)`. */
export function stockValueCents(currentQty: number, unitCostCents: number): number {
  return Math.round(currentQty * unitCostCents);
}

export function toStockItemDto(row: ItemRow): StockItemDto {
  const currentQty = Number(row.current_qty);
  const minimumQty = Number(row.minimum_qty);
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    category: row.category,
    currentQty,
    minimumQty,
    unitCostCents: row.unit_cost_cents,
    low: isLowStock(currentQty, minimumQty),
  };
}

export const listStockItems = defineService({
  name: "stock.list",
  minRole: "admin",
  input: listStockQuerySchema,
  run: async ({ tx, ctx, input }): Promise<StockList> => {
    const q = input.q === undefined || input.q === "" ? null : `%${input.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await tx<ItemRow[]>`
      select ${tx.unsafe(ITEM_COLUMNS)}
      from public.stock_items
      where restaurant_id = ${ctx.restaurantId} and archived_at is null
        and (${input.category ?? null}::text is null or category = ${input.category ?? null})
        and (${q}::text is null or name ilike ${q})
      order by name, id
    `;
    const [totals] = await tx<{ low_count: number; total_value: number }[]>`
      select count(*) filter (where current_qty <= minimum_qty)::int as low_count,
             coalesce(sum(round(current_qty * unit_cost_cents)), 0)::bigint as total_value
      from public.stock_items
      where restaurant_id = ${ctx.restaurantId} and archived_at is null
    `;
    return {
      items: rows.map(toStockItemDto),
      lowCount: totals?.low_count ?? 0,
      totalValueCents: Number(totals?.total_value ?? 0),
    };
  },
});

export const saveStockItem = defineService({
  name: "stock.save",
  minRole: "admin",
  input: saveStockItemSchema,
  run: async ({ tx, ctx, input }): Promise<StockItemDto> => {
    if (input.id === undefined) {
      const [created] = await tx<ItemRow[]>`
        insert into public.stock_items (restaurant_id, name, unit, category, minimum_qty, unit_cost_cents)
        values (${ctx.restaurantId}, ${input.name}, ${input.unit}, ${input.category}, ${input.minimumQty},
          ${input.unitCostCents})
        returning ${tx.unsafe(ITEM_COLUMNS)}
      `;
      if (created === undefined) throw new AppError("forbidden", "Your role cannot perform this action.");
      // The opening balance is an `in` movement, so history explains every quantity (FR-061).
      if (input.initialQty !== undefined && input.initialQty > 0) {
        await tx`
          insert into public.stock_movements (restaurant_id, stock_item_id, kind, qty, reason, created_by)
          values (${ctx.restaurantId}, ${created.id}, 'in', ${input.initialQty}, 'Saldo inicial',
            ${ctx.actorType === "user" ? ctx.userId : null})
        `;
        const [refreshed] = await tx<
          ItemRow[]
        >`select ${tx.unsafe(ITEM_COLUMNS)} from public.stock_items where id = ${created.id}`;
        return toStockItemDto(refreshed ?? created);
      }
      return toStockItemDto(created);
    }
    const [updated] = await tx<ItemRow[]>`
      update public.stock_items set
        name = ${input.name}, unit = ${input.unit}, category = ${input.category},
        minimum_qty = ${input.minimumQty}, unit_cost_cents = ${input.unitCostCents}, updated_at = now()
      where id = ${input.id} and restaurant_id = ${ctx.restaurantId} and archived_at is null
      returning ${tx.unsafe(ITEM_COLUMNS)}
    `;
    if (updated === undefined) throw new AppError("not_found", "Stock item not found.");
    return toStockItemDto(updated);
  },
});

export const archiveStockItem = defineService({
  name: "stock.archive",
  minRole: "admin",
  input: archiveStockItemSchema,
  run: async ({ tx, ctx, input }): Promise<{ id: string }> => {
    const [row] = await tx<{ id: string }[]>`
      update public.stock_items set archived_at = now(), updated_at = now()
      where id = ${input.id} and restaurant_id = ${ctx.restaurantId} and archived_at is null
      returning id
    `;
    if (row === undefined) throw new AppError("not_found", "Stock item not found.");
    return row;
  },
});

export const recordStockMovement = defineService({
  name: "stock.recordMovement",
  minRole: "admin",
  input: recordStockMovementSchema,
  run: async ({ tx, ctx, input }): Promise<StockMovementDto & { stockItemId: string }> => {
    // Lock the row so the sufficiency check and the trigger's update see the same balance.
    const [item] = await tx<{ current_qty: string }[]>`
      select current_qty from public.stock_items
      where id = ${input.stockItemId} and restaurant_id = ${ctx.restaurantId} and archived_at is null
      for update
    `;
    if (item === undefined) throw new AppError("not_found", "Stock item not found.");
    const delta = input.kind === "out" ? -input.qty : input.qty;
    if (Number(item.current_qty) + delta < -0.0005) {
      throw new AppError("validation_failed", "Insufficient stock.", {
        details: [{ path: "qty", code: "insufficient_stock", message: "Saldo insuficiente para esta saída." }],
      });
    }
    const [movement] = await tx<StockMovementRow[]>`
      insert into public.stock_movements (restaurant_id, stock_item_id, kind, qty, reason, created_by)
      values (${ctx.restaurantId}, ${input.stockItemId}, ${input.kind}, ${input.qty}, ${input.reason ?? null},
        ${ctx.actorType === "user" ? ctx.userId : null})
      returning id, stock_item_id, kind, qty, balance_after, reason, created_at
    `;
    if (movement === undefined) throw new AppError("forbidden", "Your role cannot perform this action.");
    return { ...toMovementDto(movement), stockItemId: movement.stock_item_id };
  },
});

function toMovementDto(row: StockMovementRow): StockMovementDto {
  return {
    id: row.id,
    kind: row.kind,
    qty: Number(row.qty),
    balanceAfter: Number(row.balance_after),
    reason: row.reason,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export const listStockMovements = defineService({
  name: "stock.listMovements",
  minRole: "admin",
  input: listStockMovementsSchema,
  run: async ({ tx, ctx, input }): Promise<StockMovementDto[]> => {
    const rows = await tx<StockMovementRow[]>`
      select id, stock_item_id, kind, qty, balance_after, reason, created_at
      from public.stock_movements
      where restaurant_id = ${ctx.restaurantId} and stock_item_id = ${input.stockItemId}
      order by created_at desc, id desc
      limit ${input.limit}
    `;
    return rows.map(toMovementDto);
  },
});
