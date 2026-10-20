// Settings requests (Appendix A, FR-080..FR-084, FR-096).

import { ORDER_STATUS_MESSAGE_KINDS } from "@mt/core";
import { z } from "zod";
import { centsSchema, ibgeCodeSchema, optionalOf, ufSchema } from "./common";

export const DEFAULT_TIMEZONE = "America/Sao_Paulo";
/** Settings order: the three FR-084 kinds, then the six status kinds of ADR-026. */
export const AUTOMATIC_MESSAGE_KINDS = ["welcome", "closed", "order_received", ...ORDER_STATUS_MESSAGE_KINDS] as const;
/** Kinds that may carry an approved WhatsApp template for use outside the 24-hour window (ADR-014, ADR-026). */
export const TEMPLATE_MESSAGE_KINDS: readonly (typeof AUTOMATIC_MESSAGE_KINDS)[number][] = [
  "order_received",
  ...ORDER_STATUS_MESSAGE_KINDS,
];

/** A real IANA zone name. */
export const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Fuso horário inválido.");

/** `saveProfile` (FR-080). */
export const saveProfileSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(120),
  phone: optionalOf(z.string().trim().max(30)),
  email: optionalOf(z.string().trim().email("E-mail inválido.").max(254)),
  address: optionalOf(z.string().trim().max(200)),
  cidade: optionalOf(z.string().trim().max(100)),
  uf: optionalOf(ufSchema),
  codigoMunicipio: optionalOf(ibgeCodeSchema),
});

/** `saveOrderPreferences` (FR-081, FR-082, FR-096). */
export const saveOrderPreferencesSchema = z.object({
  autoAccept: z.boolean(),
  pickupEnabled: z.boolean(),
  showDeliveryEstimate: z.boolean(),
  deliveryFeeCents: centsSchema,
  deliveryEstimateMinutes: z.number().int().min(5).max(240),
  timezone: timezoneSchema.default(DEFAULT_TIMEZONE),
});

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use o formato HH:MM.");

const hoursDay = z
  .object({
    weekday: z.number().int().min(0).max(6),
    enabled: z.boolean(),
    opensAt: timeOfDay,
    closesAt: timeOfDay,
  })
  .superRefine((d, ctx) => {
    if (d.opensAt === d.closesAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["closesAt"],
        message: "Abertura e fechamento não podem ser iguais.",
      });
    }
  });

/** `saveBusinessHours` (FR-083): seven rows. A closing time earlier than the opening time ends after midnight. */
export const saveBusinessHoursSchema = z.object({ days: z.array(hoursDay).length(7) }).superRefine((v, ctx) => {
  if (new Set(v.days.map((d) => d.weekday)).size !== 7) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["days"],
      message: "Informe um horário para cada dia da semana.",
    });
  }
});

/** `saveAutomaticMessage` (FR-084, FR-200). A template applies to `order_received` and the status kinds (ADR-014, ADR-026). */
export const saveAutomaticMessageSchema = z
  .object({
    kind: z.enum(AUTOMATIC_MESSAGE_KINDS),
    enabled: z.boolean(),
    body: z.string().trim().min(1, "Escreva a mensagem.").max(1000),
    templateName: optionalOf(z.string().trim().max(512)),
    templateLanguage: optionalOf(z.string().trim().max(20)),
  })
  .superRefine((v, ctx) => {
    if ((v.templateName === null) !== (v.templateLanguage === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [v.templateName === null ? "templateName" : "templateLanguage"],
        message: "Informe o modelo e o idioma juntos.",
      });
    }
    if (!TEMPLATE_MESSAGE_KINDS.includes(v.kind) && v.templateName !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["templateName"],
        message: "Só as mensagens de pedido usam modelo.",
      });
    }
  });
