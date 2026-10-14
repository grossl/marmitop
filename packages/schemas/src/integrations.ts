// Integration configuration (Appendix A; FR-085..FR-091, FR-094; NFR-014).
// URL rules depend on deployment config, so the schemas are built by factories that take
// `allowPrivateHosts` (MT_ALLOW_PRIVATE_HOSTS=1, development only, ADR-017). The worker and the
// http package check DNS again at call time.

import { checkOutboundUrl } from "@mt/core";
import { z } from "zod";
import { uuidSchema } from "./common";

export const WEBHOOK_EVENTS = ["order.created", "order.status_changed", "message.received", "invoice.updated"] as const;
export const FISCAL_ENVIRONMENTS = ["homologacao", "producao"] as const;
export const DELIVERY_FEE_MODES = ["item", "none"] as const;
export const API_KEY_ENVIRONMENTS = ["live", "test"] as const;

export interface UrlRules {
  /** True only in development. Allows http and private hosts. */
  readonly allowPrivateHosts: boolean;
}

const URL_MESSAGES = {
  invalid_url: "URL inválida.",
  scheme_not_allowed: "Use uma URL https.",
  userinfo_not_allowed: "A URL não pode conter usuário e senha.",
  private_host: "Este endereço não é permitido.",
} as const;

function integrationUrl(rules: UrlRules, options: { trimTrailingSlash: boolean }) {
  return z
    .string()
    .trim()
    .max(2048)
    .superRefine((value, ctx) => {
      const r = checkOutboundUrl(value, rules);
      if (!r.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: URL_MESSAGES[r.reason] });
    })
    .transform((v) => (options.trimTrailingSlash ? v.replace(/\/+$/, "") : v));
}

/** Secrets are write-only (FR-094): the schema takes them in, nothing ever returns them. */
const secret = z.string().trim().min(1, "Informe o valor.").max(512);

function whatsappShape(rules: UrlRules) {
  return {
    baseUrl: integrationUrl(rules, { trimTrailingSlash: true }),
    apiKey: secret,
    webhookSecret: secret,
    phoneNumberId: z.string().trim().min(1, "Informe o número.").max(64),
  };
}

/** `connectWhatsApp` (FR-085). */
export function makeConnectWhatsAppSchema(rules: UrlRules) {
  return z.object(whatsappShape(rules));
}

/** Edit form: a secret left out keeps the stored one. */
export function makeUpdateWhatsAppSchema(rules: UrlRules) {
  return z.object(whatsappShape(rules)).partial({ apiKey: true, webhookSecret: true });
}

/** `saveWebhookEndpoint` (FR-087). */
export function makeSaveWebhookEndpointSchema(rules: UrlRules) {
  return z.object({
    url: integrationUrl(rules, { trimTrailingSlash: false }),
    events: z.array(z.enum(WEBHOOK_EVENTS)).transform((events) => [...new Set(events)]),
    enabled: z.boolean(),
  });
}

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1, "Informe um nome.").max(80),
  environment: z.enum(API_KEY_ENVIRONMENTS),
});

export const revokeApiKeySchema = z.object({ id: uuidSchema });

const serie = z.number().int().min(1).max(999);

function fiscalShape(rules: UrlRules) {
  return {
    baseUrl: integrationUrl(rules, { trimTrailingSlash: true }),
    apiKey: secret,
    webhookSecret: secret,
    environment: z.enum(FISCAL_ENVIRONMENTS),
    nfceSerie: serie,
    nfeSerie: serie,
    defaults: z.object({
      ncm: z
        .string()
        .trim()
        .regex(/^\d{8}$/, "NCM deve ter 8 dígitos."),
      cfop: z
        .string()
        .trim()
        .regex(/^\d{4}$/, "CFOP deve ter 4 dígitos."),
      csosn: z
        .string()
        .trim()
        .regex(/^\d{3}$/, "CSOSN deve ter 3 dígitos."),
      pisCst: z
        .string()
        .trim()
        .regex(/^\d{2}$/, "CST deve ter 2 dígitos."),
      cofinsCst: z
        .string()
        .trim()
        .regex(/^\d{2}$/, "CST deve ter 2 dígitos."),
    }),
    deliveryFeeMode: z.enum(DELIVERY_FEE_MODES).default("item"),
  };
}

/** `saveFiscalConfig` (FR-090). Every default is required before an invoice can be issued. */
export function makeSaveFiscalConfigSchema(rules: UrlRules) {
  return z.object(fiscalShape(rules));
}

export function makeUpdateFiscalConfigSchema(rules: UrlRules) {
  return z.object(fiscalShape(rules)).partial({ apiKey: true, webhookSecret: true });
}
