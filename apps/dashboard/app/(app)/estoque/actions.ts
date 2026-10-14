"use server";

import { archiveStockItem, listStockItems, listStockMovements, recordStockMovement, saveStockItem } from "@mt/http";
import {
  archiveStockItemSchema,
  listStockMovementsSchema,
  listStockQuerySchema,
  recordStockMovementSchema,
  saveStockItemSchema,
} from "@mt/schemas";
import { revalidatePath } from "next/cache";

import { adminAction } from "@/lib/server/safe-action";

// 06.api-spec.md Appendix A: listStockItems, saveStockItem, recordStockMovement (FR-060..069).
// `current_qty` changes only through movements; no action takes a quantity edit.

export const listStockItemsAction = adminAction(
  { name: "stock.list", input: listStockQuerySchema },
  ({ deps, ctx, input }) => listStockItems(deps, ctx, input),
);

export const saveStockItemAction = adminAction(
  { name: "stock.save", input: saveStockItemSchema },
  async ({ deps, ctx, input }) => {
    const item = await saveStockItem(deps, ctx, input);
    revalidatePath("/estoque");
    return item;
  },
);

export const archiveStockItemAction = adminAction(
  { name: "stock.archive", input: archiveStockItemSchema },
  async ({ deps, ctx, input }) => {
    const result = await archiveStockItem(deps, ctx, input);
    revalidatePath("/estoque");
    return result;
  },
);

export const recordStockMovementAction = adminAction(
  { name: "stock.recordMovement", input: recordStockMovementSchema },
  async ({ deps, ctx, input }) => {
    const movement = await recordStockMovement(deps, ctx, input);
    revalidatePath("/estoque");
    return movement;
  },
);

export const listStockMovementsAction = adminAction(
  { name: "stock.listMovements", input: listStockMovementsSchema },
  ({ deps, ctx, input }) => listStockMovements(deps, ctx, input),
);
