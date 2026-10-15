// The restaurant's backend-uatis connection, read inside a `system` context
// (ADR-002, ADR-012). Secrets are unsealed into local values only; nothing here
// logs or returns them past the caller (NFR-011).

import type { Tx } from "@mt/db";

import type { SystemContext } from "../../context";
import type { ServiceDeps } from "../../deps";
import { openSecret } from "../admin/internal";

export type WhatsAppStatus = "disconnected" | "connected" | "error";

export interface WhatsAppConnection {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly phoneNumberId: string;
  readonly status: WhatsAppStatus;
  readonly lastSyncCursor: Date | null;
}

/** The context the worker and the inbound webhook use: actor `system`, which RLS treats as admin. */
export function systemCtx(restaurantId: string): SystemContext {
  return { restaurantId, role: "admin", actorType: "system" };
}

interface Row {
  base_url: string;
  api_key_secret_id: string;
  webhook_secret_id: string | null;
  uatis_organization_id: string | null;
  phone_number_id: string;
  status: WhatsAppStatus;
  last_sync_cursor: Date | null;
}

async function loadRow(tx: Tx, restaurantId: string): Promise<Row | undefined> {
  const [row] = await tx<Row[]>`
    select base_url, api_key_secret_id, webhook_secret_id, uatis_organization_id, phone_number_id, status,
           last_sync_cursor
    from public.integrations_whatsapp where restaurant_id = ${restaurantId}
  `;
  return row;
}

/** Null when the restaurant has no WhatsApp integration row. */
export async function loadWhatsAppConnection(
  tx: Tx,
  deps: ServiceDeps,
  restaurantId: string,
): Promise<WhatsAppConnection | null> {
  const row = await loadRow(tx, restaurantId);
  if (row === undefined) return null;
  const apiKey = await openSecret(tx, deps, systemCtx(restaurantId), row.api_key_secret_id, "uatis_api_key");
  return {
    baseUrl: row.base_url,
    apiKey,
    phoneNumberId: row.phone_number_id,
    status: row.status,
    lastSyncCursor: row.last_sync_cursor,
  };
}

/**
 * The webhook signing secret and the stored organization for `POST /v1/webhooks/uatis/{restaurant_id}`,
 * or null when there is no integration row, the admin disconnected it, or no secret is configured
 * (a pull webhook needs none) (FR-118, FR-175). An `error` status still accepts webhooks: a failed
 * connection test must not drop customer messages.
 */
export async function loadUatisWebhookVerification(
  tx: Tx,
  deps: ServiceDeps,
  restaurantId: string,
): Promise<{ secret: string; organizationId: string | null } | null> {
  const row = await loadRow(tx, restaurantId);
  if (row === undefined || row.status === "disconnected" || row.webhook_secret_id === null) return null;
  const secret = await openSecret(tx, deps, systemCtx(restaurantId), row.webhook_secret_id, "uatis_webhook_secret");
  return { secret, organizationId: row.uatis_organization_id };
}
