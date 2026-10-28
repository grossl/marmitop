"use server";

import { type PreparedPublicOrder, type PublicOrderInput, preparePublicOrder, toActionError } from "@mt/http";
import { unstable_rethrow } from "next/navigation";

import type { ActionResult } from "@/lib/server/action-core";
import { requireDeps } from "@/lib/server/deps";

// Public menu checkout (ADR-031, ADR-033, FR-232, FR-238). The one Server Action without a
// session: the restaurant comes from the page's public id, never from a session or the client
// body. It creates no order: it saves a draft and returns the WhatsApp text that carries it.

export async function preparePublicOrderAction(
  publicId: string,
  input: PublicOrderInput,
): Promise<ActionResult<PreparedPublicOrder>> {
  try {
    return { ok: true, data: await preparePublicOrder(requireDeps(), publicId, input) };
  } catch (error) {
    unstable_rethrow(error);
    const actionError = toActionError(error);
    // Name and error class only: a driver message can carry connection details (NFR-011).
    if (actionError.code === "internal_error") {
      console.error("public action failed", {
        action: "orders.preparePublic",
        error: error instanceof Error ? error.name : typeof error,
      });
    }
    return { ok: false, error: actionError };
  }
}
