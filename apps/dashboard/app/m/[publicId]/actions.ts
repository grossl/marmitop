"use server";

import { type CreatedOrder, type PublicOrderInput, placePublicOrder, toActionError } from "@mt/http";
import { unstable_rethrow } from "next/navigation";

import type { ActionResult } from "@/lib/server/action-core";
import { requireDeps } from "@/lib/server/deps";

// Public menu checkout (ADR-031, FR-232). The one Server Action without a session:
// the restaurant comes from the page's public id, never from a session or the client
// body, and placePublicOrder applies the business hours and rate limits.

export async function placePublicOrderAction(
  publicId: string,
  input: PublicOrderInput,
): Promise<ActionResult<Pick<CreatedOrder, "code" | "totalCents">>> {
  try {
    const created = await placePublicOrder(requireDeps(), publicId, input);
    return { ok: true, data: { code: created.code, totalCents: created.totalCents } };
  } catch (error) {
    unstable_rethrow(error);
    const actionError = toActionError(error);
    // Name and error class only: a driver message can carry connection details (NFR-011).
    if (actionError.code === "internal_error") {
      console.error("public action failed", {
        action: "orders.placePublic",
        error: error instanceof Error ? error.name : typeof error,
      });
    }
    return { ok: false, error: actionError };
  }
}
