import "server-only";

import { resolveUserContext } from "@mt/http";
import { unstable_rethrow } from "next/navigation";

import { createActionBuilders } from "@/lib/server/action-core";
import { requireDeps } from "@/lib/server/deps";
import { getSessionUser } from "@/lib/server/session";

/**
 * The dashboard's write-authorization boundary (ADR-004, ADR-005, FR-008).
 * Build every Server Action with one of these:
 *
 *   memberAction  admin or attendant (Appendix A `AA`)
 *   adminAction   admin only          (Appendix A `A`)
 *
 *   "use server";
 *   export const saveProfile = adminAction(
 *     { name: "settings.saveProfile", input: saveProfileSchema },
 *     ({ deps, ctx, input }) => updateRestaurantProfile(deps, ctx, input),
 *   );
 *
 * The handler receives `ctx` resolved from the session and
 * `restaurant_members`. Input never carries a restaurant id, user id, or role.
 */
export const { memberAction, adminAction } = createActionBuilders({
  async resolveCaller() {
    const user = await getSessionUser();
    if (!user) return null;
    return { userId: user.id, ctx: await resolveUserContext(requireDeps(), user.id) };
  },
  getDeps: requireDeps,
  rethrowFrameworkError: unstable_rethrow,
  logUnexpected(actionName, error) {
    // Name and error class only: a driver message can carry connection details (NFR-011).
    console.error("dashboard action failed", { action: actionName, error: error instanceof Error ? error.name : typeof error });
  },
});

export type { ActionResult } from "@/lib/server/action-core";
