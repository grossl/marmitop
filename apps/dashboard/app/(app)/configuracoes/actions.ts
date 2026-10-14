"use server";

import { getRestaurantProfile, updateRestaurantProfile } from "@mt/http";
import { saveProfileSchema } from "@mt/schemas";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { adminAction } from "@/lib/server/safe-action";

// The reference Server Actions for the pattern in packages/http/README.md
// (06.api-spec.md Appendix A `getSettings` profile part, `saveProfile`).
// T4.10 wires the Settings screen to them.

export const getProfileAction = adminAction(
  { name: "settings.getProfile", input: z.undefined() },
  ({ deps, ctx }) => getRestaurantProfile(deps, ctx, undefined),
);

export const saveProfileAction = adminAction(
  { name: "settings.saveProfile", input: saveProfileSchema },
  async ({ deps, ctx, input }) => {
    const profile = await updateRestaurantProfile(deps, ctx, input);
    revalidatePath("/configuracoes");
    return profile;
  },
);
