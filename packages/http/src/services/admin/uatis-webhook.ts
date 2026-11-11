// packages/http/src/services/admin/uatis-webhook.ts
//
// Settings → WhatsApp → webhook (ADR-021, ADR-023; FR-170..FR-173, FR-178, FR-179;
// 06.api-spec.md Appendix A).
//
//   enableUatisWebhook     read the organization, delete the stored webhook, register a new one:
//                          push when MT_PUBLIC_URL is public https:443, pull otherwise; production
//                          refuses pull (ADR-041)
//   disableUatisWebhook    delete it and clear the columns; the webhook secret stays
//   getUatisWebhookStatus  state, mode, next mode, last push, last feed read, five attempts
//
// Secret rules (ADR-012, NFR-011): the push secret is sealed at once and never returned,
// logged, or audited; the audit row carries its last four characters only.

import {
  AppError,
  checkPublicBaseUrl,
  GatewayError,
  type PublicUrlRejection,
  type UatisWebhookEventName,
  type UatisWebhookMode,
  type WhatsAppGateway,
  uatisWebhookTargetUrl,
} from "@mt/core";
import type { Tx } from "@mt/db";
import { z } from "zod";

import type { ServiceContext } from "../../context";
import type { ServiceDeps } from "../../deps";
import { defineService } from "../../service";
import { deleteSecret, openSecret, storeSecret, writeAudit } from "./internal";

/** The events Marmitop subscribes to (ADR-021). */
export const UATIS_WEBHOOK_EVENTS: readonly UatisWebhookEventName[] = ["message.created", "message.updated"];

const DESCRIPTION = "Marmitop";

/** ADR-041, FR-172: production never registers pull. */
export const PUSH_REQUIRED_ERROR =
  "Em produção o webhook precisa do modo Push: configure MT_PUBLIC_URL com a URL https pública da API.";

export type EnableUatisWebhookResult =
  | { readonly ok: true; readonly webhookId: string; readonly mode: UatisWebhookMode }
  | { readonly ok: false; readonly error: string };

export type DisableUatisWebhookResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

export interface UatisWebhookDeliveryView {
  readonly id: string;
  readonly eventType: string;
  readonly status: "pending" | "delivered" | "failed" | "exhausted";
  readonly httpStatus: number | null;
  readonly attemptNo: number;
  readonly createdAt: string;
}

export interface UatisWebhookStatus {
  readonly state: "active" | "not_registered";
  readonly mode: UatisWebhookMode | null;
  /** The mode the next "Ativar webhook" picks (FR-172). */
  readonly nextMode: UatisWebhookMode;
  /** Production: pull is refused, and a pull webhook is a leftover to register again (ADR-041). */
  readonly pushRequired: boolean;
  readonly publicUrl: {
    readonly ok: boolean;
    /** `MT_PUBLIC_URL` as configured; not a secret. */
    readonly url: string | null;
    readonly reason: PublicUrlRejection | null;
  };
  readonly webhookId: string | null;
  readonly lastWebhookAt: string | null;
  readonly lastSyncedAt: string | null;
  readonly deliveries: readonly UatisWebhookDeliveryView[] | null;
  readonly deliveriesError: string | null;
}

interface Row {
  base_url: string;
  api_key_secret_id: string;
  webhook_secret_id: string | null;
  uatis_webhook_id: string | null;
  uatis_webhook_mode: UatisWebhookMode | null;
  last_webhook_at: Date | null;
  last_synced_at: Date | null;
}

async function loadRow(tx: Tx, ctx: ServiceContext, lock: boolean): Promise<Row> {
  const rows = lock
    ? await tx<Row[]>`
        select base_url, api_key_secret_id, webhook_secret_id, uatis_webhook_id, uatis_webhook_mode,
               last_webhook_at, last_synced_at
        from public.integrations_whatsapp where restaurant_id = ${ctx.restaurantId} for update`
    : await tx<Row[]>`
        select base_url, api_key_secret_id, webhook_secret_id, uatis_webhook_id, uatis_webhook_mode,
               last_webhook_at, last_synced_at
        from public.integrations_whatsapp where restaurant_id = ${ctx.restaurantId}`;
  const [row] = rows;
  if (row === undefined) throw new AppError("whatsapp_not_configured", "WhatsApp is not configured.");
  return row;
}

async function gatewayFor(tx: Tx, deps: ServiceDeps, ctx: ServiceContext, row: Row): Promise<WhatsAppGateway> {
  const apiKey = await openSecret(tx, deps, ctx, row.api_key_secret_id, "uatis_api_key");
  return deps.gateways.whatsapp({ baseUrl: row.base_url, apiKey });
}

/** Allow-listed pt-BR text for a gateway failure (NFR-011). Never the remote's own message. */
export function uatisWebhookError(e: GatewayError): string {
  const f = e.failure;
  if (f.kind === "refused") return "Endereço do backend-uatis não permitido.";
  if (f.kind === "timeout") return "O backend-uatis não respondeu a tempo.";
  if (f.kind === "http") {
    if (f.status === 401) return "A chave de API foi recusada pelo backend-uatis.";
    if (f.status === 403) return "A chave da API do Uatis precisa ser de administrador.";
    if (f.status === 422) return "O backend-uatis recusou o cadastro do webhook.";
    return `O backend-uatis respondeu com erro (HTTP ${f.status}).`;
  }
  return "Não foi possível conectar ao backend-uatis.";
}

async function clearWebhookColumns(tx: Tx, restaurantId: string): Promise<void> {
  await tx`
    update public.integrations_whatsapp set
      uatis_webhook_id = null, uatis_webhook_mode = null, uatis_organization_id = null, uatis_feed_cursor = null
    where restaurant_id = ${restaurantId}
  `;
}

export const enableUatisWebhook = defineService({
  name: "settings.enableUatisWebhook",
  minRole: "admin",
  input: z.undefined(),
  run: async ({ tx, deps, ctx }): Promise<EnableUatisWebhookResult> => {
    const row = await loadRow(tx, ctx, true);
    const publicUrl = checkPublicBaseUrl(deps.publicUrl);
    // ADR-041: before any gateway call, so the stored webhook stays as it was.
    if (!publicUrl.ok && deps.env === "production") return { ok: false, error: PUSH_REQUIRED_ERROR };
    const gateway = await gatewayFor(tx, deps, ctx, row);
    const mode: UatisWebhookMode = publicUrl.ok ? "push" : "pull";

    let removedOld = false;
    let created: Awaited<ReturnType<WhatsAppGateway["createWebhook"]>>;
    let organizationId: string;
    try {
      organizationId = (await gateway.getOrganization()).id;
      if (row.uatis_webhook_id !== null) {
        await gateway.deleteWebhook(row.uatis_webhook_id);
        removedOld = true;
      }
      created = await gateway.createWebhook(
        publicUrl.ok
          ? {
              mode: "push",
              url: uatisWebhookTargetUrl(publicUrl.url, ctx.restaurantId),
              events: UATIS_WEBHOOK_EVENTS,
              description: DESCRIPTION,
            }
          : { mode: "pull", url: null, events: UATIS_WEBHOOK_EVENTS, description: DESCRIPTION },
      );
    } catch (e) {
      if (!(e instanceof GatewayError)) throw e;
      // FR-171: once the old webhook is gone, the stored id points at nothing.
      if (removedOld) await clearWebhookColumns(tx, ctx.restaurantId);
      return { ok: false, error: uatisWebhookError(e) };
    }

    let secretId = row.webhook_secret_id;
    let last4: string | null = null;
    if (created.mode === "push" && created.secret !== null) {
      const stored = await storeSecret(tx, deps, ctx, "uatis_webhook_secret", created.secret);
      secretId = stored.id;
      last4 = stored.last4;
    }
    await tx`
      update public.integrations_whatsapp set
        uatis_webhook_id = ${created.id},
        uatis_webhook_mode = ${created.mode},
        uatis_organization_id = ${organizationId},
        uatis_feed_cursor = null,
        webhook_secret_id = ${secretId}
      where restaurant_id = ${ctx.restaurantId}
    `;
    if (secretId !== row.webhook_secret_id && row.webhook_secret_id !== null) {
      await deleteSecret(tx, ctx, row.webhook_secret_id, "uatis_webhook_secret");
    }
    await writeAudit(tx, ctx, {
      action: "integration.whatsapp.webhook_enable",
      entityType: "integrations_whatsapp",
      entityId: null,
      context: { webhook_id: created.id, mode: created.mode, ...(last4 !== null ? { last4 } : {}) },
    });
    return { ok: true, webhookId: created.id, mode: created.mode };
  },
});

export const disableUatisWebhook = defineService({
  name: "settings.disableUatisWebhook",
  minRole: "admin",
  input: z.undefined(),
  run: async ({ tx, deps, ctx }): Promise<DisableUatisWebhookResult> => {
    const row = await loadRow(tx, ctx, true);
    if (row.uatis_webhook_id !== null) {
      const gateway = await gatewayFor(tx, deps, ctx, row);
      try {
        await gateway.deleteWebhook(row.uatis_webhook_id);
      } catch (e) {
        if (!(e instanceof GatewayError)) throw e;
        return { ok: false, error: uatisWebhookError(e) };
      }
    }
    await clearWebhookColumns(tx, ctx.restaurantId);
    await writeAudit(tx, ctx, {
      action: "integration.whatsapp.webhook_disable",
      entityType: "integrations_whatsapp",
      entityId: null,
      context: { webhook_id: row.uatis_webhook_id },
    });
    return { ok: true };
  },
});

export const getUatisWebhookStatus = defineService({
  name: "settings.getUatisWebhookStatus",
  minRole: "admin",
  input: z.undefined(),
  run: async ({ tx, deps, ctx }): Promise<UatisWebhookStatus> => {
    const row = await loadRow(tx, ctx, false);
    const publicUrl = checkPublicBaseUrl(deps.publicUrl);
    let deliveries: UatisWebhookDeliveryView[] | null = null;
    let deliveriesError: string | null = null;
    if (row.uatis_webhook_id !== null) {
      try {
        const gateway = await gatewayFor(tx, deps, ctx, row);
        const attempts = await gateway.listWebhookDeliveries(row.uatis_webhook_id, { limit: 5 });
        deliveries = attempts.slice(0, 5).map((d) => ({
          id: d.id,
          eventType: d.eventType,
          status: d.status,
          httpStatus: d.httpStatus,
          attemptNo: d.attemptNo,
          createdAt: d.createdAt.toISOString(),
        }));
      } catch {
        // FR-178: the page still renders; any failure (gateway or secret) becomes one note.
        deliveriesError = "Não foi possível ler as entregas do backend-uatis.";
      }
    }
    return {
      state: row.uatis_webhook_id === null ? "not_registered" : "active",
      mode: row.uatis_webhook_mode,
      nextMode: publicUrl.ok ? "push" : "pull",
      pushRequired: deps.env === "production",
      publicUrl: {
        ok: publicUrl.ok,
        url: deps.publicUrl ?? null,
        reason: publicUrl.ok ? null : publicUrl.reason,
      },
      webhookId: row.uatis_webhook_id,
      lastWebhookAt: row.last_webhook_at?.toISOString() ?? null,
      lastSyncedAt: row.last_synced_at?.toISOString() ?? null,
      deliveries,
      deliveriesError,
    };
  },
});
