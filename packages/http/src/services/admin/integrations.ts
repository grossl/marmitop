// packages/http/src/services/admin/integrations.ts
//
// Settings → integrations (FR-085..FR-091, FR-094, 06.api-spec.md Appendix A):
// WhatsApp (backend-uatis), fiscal (web-nf), outbound webhook, API keys.
//
// Secret rules (ADR-012, 07.security.md, NFR-011):
//   * secrets are sealed with `deps.secretBox` into `secrets` rows;
//   * no result carries a plaintext secret, except the three "shown once"
//     values the spec names: a new API key, a new webhook signing secret;
//   * every secret and API-key change writes an `audit_logs` row with kind and
//     last4 only.

import { AppError, type ConnectionCheck, generateApiKey, generateWebhookSecret } from "@mt/core";
import type { Tx } from "@mt/db";
import {
  API_KEY_ENVIRONMENTS,
  DELIVERY_FEE_MODES,
  FISCAL_ENVIRONMENTS,
  makeSaveFiscalConfigSchema,
  makeSaveWebhookEndpointSchema,
  makeUpdateFiscalConfigSchema,
  makeUpdateWhatsAppSchema,
  parseOrThrow,
  revokeApiKeySchema,
  WEBHOOK_EVENTS,
} from "@mt/schemas";
import { z } from "zod";

import type { ServiceContext } from "../../context";
import type { ServiceDeps } from "../../deps";
import { defineService } from "../../service";
import {
  deleteSecret,
  NO_SECRET,
  openSecret,
  type SecretState,
  secretStates,
  shortError,
  storeSecret,
  urlRules,
  writeAudit,
} from "./internal";

// ---------------------------------------------------------------------------
// State read by getSettings (no plaintext)
// ---------------------------------------------------------------------------

export type IntegrationStatus = "disconnected" | "connected" | "error";

export interface WhatsAppState {
  readonly baseUrl: string;
  readonly phoneNumberId: string;
  readonly status: IntegrationStatus;
  readonly lastError: string | null;
  readonly apiKey: SecretState;
  readonly webhookSecret: SecretState;
}

export interface FiscalState {
  readonly baseUrl: string;
  readonly environment: (typeof FISCAL_ENVIRONMENTS)[number];
  readonly nfceSerie: number;
  readonly nfeSerie: number;
  readonly defaults: {
    readonly ncm: string;
    readonly cfop: string;
    readonly csosn: string;
    readonly pisCst: string;
    readonly cofinsCst: string;
  };
  readonly deliveryFeeMode: (typeof DELIVERY_FEE_MODES)[number];
  readonly status: IntegrationStatus;
  readonly lastError: string | null;
  readonly apiKey: SecretState;
  readonly webhookSecret: SecretState;
}

export interface WebhookEndpointState {
  readonly url: string;
  readonly events: (typeof WEBHOOK_EVENTS)[number][];
  readonly enabled: boolean;
  readonly secret: SecretState;
}

export interface ApiKeyListItem {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly environment: (typeof API_KEY_ENVIRONMENTS)[number];
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
}

export interface IntegrationsState {
  readonly whatsapp: WhatsAppState | null;
  readonly fiscal: FiscalState | null;
  readonly webhook: WebhookEndpointState | null;
  readonly apiKeys: ApiKeyListItem[];
}

interface WhatsAppRow {
  base_url: string;
  api_key_secret_id: string;
  webhook_secret_id: string;
  phone_number_id: string;
  status: IntegrationStatus;
  last_error: string | null;
}

interface FiscalRow {
  base_url: string;
  api_key_secret_id: string;
  webhook_secret_id: string;
  environment: FiscalState["environment"];
  nfce_serie: number;
  nfe_serie: number;
  default_ncm: string;
  default_cfop: string;
  default_csosn: string | null;
  default_pis_cst: string;
  default_cofins_cst: string;
  delivery_fee_mode: FiscalState["deliveryFeeMode"];
  status: IntegrationStatus;
  last_error: string | null;
}

export async function loadIntegrationsState(tx: Tx, ctx: ServiceContext): Promise<IntegrationsState> {
  const [wa] = await tx<WhatsAppRow[]>`
    select base_url, api_key_secret_id, webhook_secret_id, phone_number_id, status, last_error
    from public.integrations_whatsapp where restaurant_id = ${ctx.restaurantId}
  `;
  const [fi] = await tx<FiscalRow[]>`
    select base_url, api_key_secret_id, webhook_secret_id, environment, nfce_serie, nfe_serie, default_ncm,
           default_cfop, default_csosn, default_pis_cst, default_cofins_cst, delivery_fee_mode, status, last_error
    from public.integrations_fiscal where restaurant_id = ${ctx.restaurantId}
  `;
  const [hook] = await tx<{ url: string; events: WebhookEndpointState["events"]; enabled: boolean; secret_id: string }[]>`
    select url, events, enabled, secret_id from public.webhook_endpoints where restaurant_id = ${ctx.restaurantId}
  `;
  const keys = await tx<
    {
      id: string;
      name: string;
      prefix: string;
      environment: ApiKeyListItem["environment"];
      created_at: Date;
      last_used_at: Date | null;
      revoked_at: Date | null;
    }[]
  >`
    select id, name, prefix, environment, created_at, last_used_at, revoked_at
    from public.api_keys where restaurant_id = ${ctx.restaurantId}
    order by created_at desc limit 100
  `;
  const states = await secretStates(tx, ctx, [
    wa?.api_key_secret_id ?? null,
    wa?.webhook_secret_id ?? null,
    fi?.api_key_secret_id ?? null,
    fi?.webhook_secret_id ?? null,
    hook?.secret_id ?? null,
  ]);
  const state = (id: string | undefined) => (id === undefined ? NO_SECRET : (states.get(id) ?? NO_SECRET));
  return {
    whatsapp: wa
      ? {
          baseUrl: wa.base_url,
          phoneNumberId: wa.phone_number_id,
          status: wa.status,
          lastError: wa.last_error,
          apiKey: state(wa.api_key_secret_id),
          webhookSecret: state(wa.webhook_secret_id),
        }
      : null,
    fiscal: fi
      ? {
          baseUrl: fi.base_url,
          environment: fi.environment,
          nfceSerie: fi.nfce_serie,
          nfeSerie: fi.nfe_serie,
          defaults: {
            ncm: fi.default_ncm,
            cfop: fi.default_cfop,
            csosn: fi.default_csosn ?? "",
            pisCst: fi.default_pis_cst,
            cofinsCst: fi.default_cofins_cst,
          },
          deliveryFeeMode: fi.delivery_fee_mode,
          status: fi.status,
          lastError: fi.last_error,
          apiKey: state(fi.api_key_secret_id),
          webhookSecret: state(fi.webhook_secret_id),
        }
      : null,
    webhook: hook ? { url: hook.url, events: hook.events, enabled: hook.enabled, secret: state(hook.secret_id) } : null,
    apiKeys: keys.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      environment: k.environment,
      createdAt: k.created_at.toISOString(),
      lastUsedAt: k.last_used_at?.toISOString() ?? null,
      revokedAt: k.revoked_at?.toISOString() ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function missingField(path: string, message: string): AppError {
  return new AppError("validation_failed", "The request body is invalid.", {
    details: [{ path, code: "required", message }],
  });
}

async function checkGateway(run: () => Promise<ConnectionCheck>): Promise<ConnectionCheck> {
  try {
    return await run();
  } catch {
    // Real adapters arrive in P5/P6. A thrown error never reaches the caller (NFR-011).
    return { ok: false, error: "Não foi possível acessar o serviço." };
  }
}

async function setStatus(
  tx: Tx,
  table: "integrations_whatsapp" | "integrations_fiscal",
  restaurantId: string,
  check: ConnectionCheck,
): Promise<{ status: IntegrationStatus; lastError: string | null }> {
  const status: IntegrationStatus = check.ok ? "connected" : "error";
  const lastError = check.ok ? null : shortError(check.error);
  await tx`
    update public.${tx(table)} set status = ${status}, last_error = ${lastError}
    where restaurant_id = ${restaurantId}
  `;
  return { status, lastError };
}

export interface ConnectionResult {
  readonly status: IntegrationStatus;
  readonly lastError: string | null;
}

// ---------------------------------------------------------------------------
// WhatsApp (FR-085, FR-086)
// ---------------------------------------------------------------------------

/** Loose shape for the action layer; the service re-validates URLs with the deployment rules. */
export const connectWhatsAppInput = z.object({
  baseUrl: z.string(),
  apiKey: z.string().optional(),
  webhookSecret: z.string().optional(),
  phoneNumberId: z.string(),
});

export const connectWhatsApp = defineService({
  name: "settings.connectWhatsApp",
  minRole: "admin",
  input: connectWhatsAppInput,
  run: async ({ tx, deps, ctx, input: raw }): Promise<ConnectionResult> => {
    const input = parseOrThrow(makeUpdateWhatsAppSchema(urlRules(deps)), raw);
    const [existing] = await tx<{ api_key_secret_id: string; webhook_secret_id: string }[]>`
      select api_key_secret_id, webhook_secret_id from public.integrations_whatsapp
      where restaurant_id = ${ctx.restaurantId} for update
    `;
    if (existing === undefined) {
      if (input.apiKey === undefined) throw missingField("apiKey", "Informe a chave de API.");
      if (input.webhookSecret === undefined) throw missingField("webhookSecret", "Informe o segredo do webhook.");
    }

    const oldIds: { id: string; kind: "uatis_api_key" | "uatis_webhook_secret" }[] = [];
    let apiKeyId = existing?.api_key_secret_id ?? "";
    let webhookId = existing?.webhook_secret_id ?? "";
    if (input.apiKey !== undefined) {
      if (existing) oldIds.push({ id: existing.api_key_secret_id, kind: "uatis_api_key" });
      apiKeyId = (await storeSecret(tx, deps, ctx, "uatis_api_key", input.apiKey)).id;
    }
    if (input.webhookSecret !== undefined) {
      if (existing) oldIds.push({ id: existing.webhook_secret_id, kind: "uatis_webhook_secret" });
      webhookId = (await storeSecret(tx, deps, ctx, "uatis_webhook_secret", input.webhookSecret)).id;
    }

    await tx`
      insert into public.integrations_whatsapp
        (restaurant_id, base_url, api_key_secret_id, webhook_secret_id, phone_number_id, status, last_error)
      values (${ctx.restaurantId}, ${input.baseUrl}, ${apiKeyId}, ${webhookId}, ${input.phoneNumberId}, 'disconnected', null)
      on conflict (restaurant_id) do update set
        base_url = excluded.base_url,
        api_key_secret_id = excluded.api_key_secret_id,
        webhook_secret_id = excluded.webhook_secret_id,
        phone_number_id = excluded.phone_number_id,
        status = 'disconnected',
        last_error = null
    `;
    for (const old of oldIds) await deleteSecret(tx, ctx, old.id, old.kind);

    const apiKey = input.apiKey ?? (await openSecret(tx, deps, ctx, apiKeyId, "uatis_api_key"));
    const check = await checkGateway(() => deps.gateways.whatsapp({ baseUrl: input.baseUrl, apiKey }).testConnection());
    const result = await setStatus(tx, "integrations_whatsapp", ctx.restaurantId, check);
    await writeAudit(tx, ctx, {
      action: "integration.whatsapp.connect",
      entityType: "integrations_whatsapp",
      entityId: null,
      context: { status: result.status },
    });
    return result;
  },
});

async function loadWhatsApp(tx: Tx, deps: ServiceDeps, ctx: ServiceContext) {
  const [row] = await tx<{ base_url: string; api_key_secret_id: string }[]>`
    select base_url, api_key_secret_id from public.integrations_whatsapp where restaurant_id = ${ctx.restaurantId}
  `;
  if (row === undefined) throw new AppError("whatsapp_not_configured", "WhatsApp is not configured.");
  const apiKey = await openSecret(tx, deps, ctx, row.api_key_secret_id, "uatis_api_key");
  return { baseUrl: row.base_url, apiKey };
}

export const testWhatsAppConnection = defineService({
  name: "settings.testWhatsAppConnection",
  minRole: "admin",
  input: z.undefined(),
  run: async ({ tx, deps, ctx }): Promise<ConnectionResult> => {
    const conn = await loadWhatsApp(tx, deps, ctx);
    const check = await checkGateway(() => deps.gateways.whatsapp(conn).testConnection());
    return setStatus(tx, "integrations_whatsapp", ctx.restaurantId, check);
  },
});

export const disconnectWhatsApp = defineService({
  name: "settings.disconnectWhatsApp",
  minRole: "admin",
  input: z.undefined(),
  run: async ({ tx, ctx }): Promise<{ disconnected: boolean }> => {
    const [row] = await tx<{ api_key_secret_id: string; webhook_secret_id: string }[]>`
      delete from public.integrations_whatsapp where restaurant_id = ${ctx.restaurantId}
      returning api_key_secret_id, webhook_secret_id
    `;
    if (row === undefined) return { disconnected: false };
    await deleteSecret(tx, ctx, row.api_key_secret_id, "uatis_api_key");
    await deleteSecret(tx, ctx, row.webhook_secret_id, "uatis_webhook_secret");
    await writeAudit(tx, ctx, {
      action: "integration.whatsapp.disconnect",
      entityType: "integrations_whatsapp",
      entityId: null,
      context: {},
    });
    return { disconnected: true };
  },
});

// ---------------------------------------------------------------------------
// Fiscal (FR-090, FR-091)
// ---------------------------------------------------------------------------

export const saveFiscalConfigInput = z.object({
  baseUrl: z.string(),
  apiKey: z.string().optional(),
  webhookSecret: z.string().optional(),
  environment: z.string(),
  nfceSerie: z.number(),
  nfeSerie: z.number(),
  defaults: z.object({
    ncm: z.string(),
    cfop: z.string(),
    csosn: z.string(),
    pisCst: z.string(),
    cofinsCst: z.string(),
  }),
  deliveryFeeMode: z.string().optional(),
});

export const saveFiscalConfig = defineService({
  name: "settings.saveFiscalConfig",
  minRole: "admin",
  input: saveFiscalConfigInput,
  run: async ({ tx, deps, ctx, input: raw }): Promise<ConnectionResult> => {
    const input = parseOrThrow(makeUpdateFiscalConfigSchema(urlRules(deps)), raw);
    const [existing] = await tx<{ api_key_secret_id: string; webhook_secret_id: string }[]>`
      select api_key_secret_id, webhook_secret_id from public.integrations_fiscal
      where restaurant_id = ${ctx.restaurantId} for update
    `;
    if (existing === undefined) {
      // The create path needs both secrets: the full schema says so with field paths.
      parseOrThrow(makeSaveFiscalConfigSchema(urlRules(deps)), raw);
    }

    const oldIds: { id: string; kind: "webnf_api_key" | "webnf_webhook_secret" }[] = [];
    let apiKeyId = existing?.api_key_secret_id ?? "";
    let webhookId = existing?.webhook_secret_id ?? "";
    if (input.apiKey !== undefined) {
      if (existing) oldIds.push({ id: existing.api_key_secret_id, kind: "webnf_api_key" });
      apiKeyId = (await storeSecret(tx, deps, ctx, "webnf_api_key", input.apiKey)).id;
    }
    if (input.webhookSecret !== undefined) {
      if (existing) oldIds.push({ id: existing.webhook_secret_id, kind: "webnf_webhook_secret" });
      webhookId = (await storeSecret(tx, deps, ctx, "webnf_webhook_secret", input.webhookSecret)).id;
    }

    const d = input.defaults;
    await tx`
      insert into public.integrations_fiscal
        (restaurant_id, base_url, api_key_secret_id, webhook_secret_id, environment, nfce_serie, nfe_serie,
         default_ncm, default_cfop, default_csosn, default_pis_cst, default_cofins_cst, delivery_fee_mode,
         status, last_error)
      values (${ctx.restaurantId}, ${input.baseUrl}, ${apiKeyId}, ${webhookId}, ${input.environment},
              ${input.nfceSerie}, ${input.nfeSerie}, ${d.ncm}, ${d.cfop}, ${d.csosn}, ${d.pisCst}, ${d.cofinsCst},
              ${input.deliveryFeeMode}, 'disconnected', null)
      on conflict (restaurant_id) do update set
        base_url = excluded.base_url,
        api_key_secret_id = excluded.api_key_secret_id,
        webhook_secret_id = excluded.webhook_secret_id,
        environment = excluded.environment,
        nfce_serie = excluded.nfce_serie,
        nfe_serie = excluded.nfe_serie,
        default_ncm = excluded.default_ncm,
        default_cfop = excluded.default_cfop,
        default_csosn = excluded.default_csosn,
        default_pis_cst = excluded.default_pis_cst,
        default_cofins_cst = excluded.default_cofins_cst,
        delivery_fee_mode = excluded.delivery_fee_mode,
        status = 'disconnected',
        last_error = null
    `;
    for (const old of oldIds) await deleteSecret(tx, ctx, old.id, old.kind);
    await writeAudit(tx, ctx, {
      action: "integration.fiscal.save",
      entityType: "integrations_fiscal",
      entityId: null,
      context: { environment: input.environment },
    });
    return { status: "disconnected", lastError: null };
  },
});

export const testFiscalConnection = defineService({
  name: "settings.testFiscalConnection",
  minRole: "admin",
  input: z.undefined(),
  run: async ({ tx, deps, ctx }): Promise<ConnectionResult> => {
    const [row] = await tx<{ base_url: string; api_key_secret_id: string }[]>`
      select base_url, api_key_secret_id from public.integrations_fiscal where restaurant_id = ${ctx.restaurantId}
    `;
    if (row === undefined) throw new AppError("not_found", "Fiscal integration is not configured.");
    const apiKey = await openSecret(tx, deps, ctx, row.api_key_secret_id, "webnf_api_key");
    const check = await checkGateway(() => deps.gateways.invoices({ baseUrl: row.base_url, apiKey }).testConnection());
    return setStatus(tx, "integrations_fiscal", ctx.restaurantId, check);
  },
});

// ---------------------------------------------------------------------------
// Outbound webhook (FR-087, FR-088)
// ---------------------------------------------------------------------------

export const saveWebhookEndpointInput = z.object({
  url: z.string(),
  events: z.array(z.string()),
  enabled: z.boolean(),
});

export interface SaveWebhookResult {
  /** The signing secret, shown once, only when the endpoint was just created. */
  readonly secret: string | null;
}

export const saveWebhookEndpoint = defineService({
  name: "settings.saveWebhookEndpoint",
  minRole: "admin",
  input: saveWebhookEndpointInput,
  run: async ({ tx, deps, ctx, input: raw }): Promise<SaveWebhookResult> => {
    const input = parseOrThrow(makeSaveWebhookEndpointSchema(urlRules(deps)), raw);
    const [existing] = await tx<{ id: string }[]>`
      select id from public.webhook_endpoints where restaurant_id = ${ctx.restaurantId} for update
    `;
    if (existing) {
      await tx`
        update public.webhook_endpoints
        set url = ${input.url}, events = ${input.events}, enabled = ${input.enabled}
        where id = ${existing.id} and restaurant_id = ${ctx.restaurantId}
      `;
      await writeAudit(tx, ctx, {
        action: "integration.webhook.save",
        entityType: "webhook_endpoints",
        entityId: existing.id,
        context: { enabled: input.enabled },
      });
      return { secret: null };
    }
    const secret = generateWebhookSecret();
    const stored = await storeSecret(tx, deps, ctx, "outbound_webhook_secret", secret);
    const [row] = await tx<{ id: string }[]>`
      insert into public.webhook_endpoints (restaurant_id, url, secret_id, enabled, events)
      values (${ctx.restaurantId}, ${input.url}, ${stored.id}, ${input.enabled}, ${input.events})
      returning id
    `;
    await writeAudit(tx, ctx, {
      action: "integration.webhook.create",
      entityType: "webhook_endpoints",
      entityId: row?.id ?? null,
      context: { enabled: input.enabled },
    });
    return { secret };
  },
});

export const rotateWebhookSecret = defineService({
  name: "settings.rotateWebhookSecret",
  minRole: "admin",
  input: z.undefined(),
  run: async ({ tx, deps, ctx }): Promise<{ secret: string }> => {
    const [existing] = await tx<{ id: string; secret_id: string }[]>`
      select id, secret_id from public.webhook_endpoints where restaurant_id = ${ctx.restaurantId} for update
    `;
    if (existing === undefined) throw new AppError("not_found", "No webhook endpoint is configured.");
    const secret = generateWebhookSecret();
    const stored = await storeSecret(tx, deps, ctx, "outbound_webhook_secret", secret);
    await tx`
      update public.webhook_endpoints set secret_id = ${stored.id}
      where id = ${existing.id} and restaurant_id = ${ctx.restaurantId}
    `;
    await deleteSecret(tx, ctx, existing.secret_id, "outbound_webhook_secret");
    return { secret };
  },
});

// ---------------------------------------------------------------------------
// API keys (FR-089, ADR-009, ADR-017)
// ---------------------------------------------------------------------------

export const createApiKeyInput = z.object({ name: z.string(), environment: z.string() });

export interface CreatedApiKey {
  readonly id: string;
  /** The full key. Shown once, never stored. */
  readonly key: string;
  readonly prefix: string;
  readonly name: string;
  readonly environment: ApiKeyListItem["environment"];
}

export const createApiKey = defineService({
  name: "settings.createApiKey",
  minRole: "admin",
  input: createApiKeyInput,
  run: async ({ tx, ctx, input: raw }): Promise<CreatedApiKey> => {
    const input = parseOrThrow(
      z.object({
        name: z.string().trim().min(1, "Informe um nome.").max(80),
        environment: z.enum(API_KEY_ENVIRONMENTS),
      }),
      raw,
    );
    const generated = generateApiKey(input.environment);
    const createdBy = ctx.actorType === "user" ? ctx.userId : null;
    const [row] = await tx<{ id: string }[]>`
      insert into public.api_keys (restaurant_id, name, prefix, hash, environment, created_by)
      values (${ctx.restaurantId}, ${input.name}, ${generated.prefix}, ${generated.hash}, ${input.environment}, ${createdBy})
      returning id
    `;
    if (row === undefined) throw new AppError("internal_error", "API key was not stored.");
    await writeAudit(tx, ctx, {
      action: "api_key.create",
      entityType: "api_keys",
      entityId: row.id,
      context: { kind: "api_key", last4: generated.key.slice(-4), prefix: generated.prefix, environment: input.environment },
    });
    return { id: row.id, key: generated.key, prefix: generated.prefix, name: input.name, environment: input.environment };
  },
});

export const revokeApiKey = defineService({
  name: "settings.revokeApiKey",
  minRole: "admin",
  input: revokeApiKeySchema,
  run: async ({ tx, ctx, input }): Promise<{ id: string }> => {
    const [row] = await tx<{ id: string; prefix: string }[]>`
      update public.api_keys set revoked_at = now()
      where id = ${input.id} and restaurant_id = ${ctx.restaurantId} and revoked_at is null
      returning id, prefix
    `;
    if (row === undefined) throw new AppError("not_found", "API key not found.");
    await writeAudit(tx, ctx, {
      action: "api_key.revoke",
      entityType: "api_keys",
      entityId: row.id,
      context: { kind: "api_key", prefix: row.prefix },
    });
    return { id: row.id };
  },
});
