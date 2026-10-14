"use server";

import { archiveMenuItem, listMenuItems, saveMenuItem, setMenuItemAvailability } from "@mt/http";
import {
  deleteMenuItemSchema,
  listMenuItemsSchema,
  saveMenuItemSchema,
  setMenuItemAvailabilitySchema,
} from "@mt/schemas";
import { revalidatePath } from "next/cache";

import { adminAction } from "@/lib/server/safe-action";

// 06.api-spec.md Appendix A: listMenu, saveMenuItem, deleteMenuItem, setMenuItemAvailability (FR-050..059).
// The attendant reads the menu through `listMenuItems` directly in the order screens.

export const listMenuAction = adminAction({ name: "menu.list", input: listMenuItemsSchema }, ({ deps, ctx, input }) =>
  listMenuItems(deps, ctx, input),
);

export const saveMenuItemAction = adminAction(
  { name: "menu.save", input: saveMenuItemSchema },
  async ({ deps, ctx, input }) => {
    const item = await saveMenuItem(deps, ctx, input);
    revalidatePath("/menu");
    return item;
  },
);

/** "Excluir" archives the item (FR-057, ADR-018). */
export const deleteMenuItemAction = adminAction(
  { name: "menu.delete", input: deleteMenuItemSchema },
  async ({ deps, ctx, input }) => {
    const result = await archiveMenuItem(deps, ctx, input);
    revalidatePath("/menu");
    return result;
  },
);

export const setMenuItemAvailabilityAction = adminAction(
  { name: "menu.setAvailability", input: setMenuItemAvailabilitySchema },
  async ({ deps, ctx, input }) => {
    const result = await setMenuItemAvailability(deps, ctx, input);
    revalidatePath("/menu");
    return result;
  },
);
