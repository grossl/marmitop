// AI assistant schemas (12.ai-order-assistant.md, FR-180..FR-199). Tool input schemas mirror
// AI_TOOL_SPECS in @mt/core and validate every model tool call before it runs. The JSON Schemas
// state their limits in descriptions (strict tool use has no length or range keywords); Zod enforces them.

import { z } from "zod";

import { uuidSchema } from "./common";

export const aiTurnJobSchema = z.object({
  v: z.literal(1),
  restaurantId: uuidSchema,
  conversationId: uuidSchema,
  triggerMessageId: uuidSchema,
  enqueuedAt: z.string().datetime(),
  attempt: z.number().int().min(1).optional(),
});
export type AiTurnJob = z.infer<typeof aiTurnJobSchema>;

export const saveAiSettingsSchema = z.object({
  enabled: z.boolean(),
  personaName: z.string().trim().min(1).max(40),
  extraInstructions: z
    .string()
    .trim()
    .max(1000)
    .nullable()
    .transform((v) => (v === "" ? null : v)),
  autoResumeMinutes: z.number().int().min(0).max(10080),
  allowOverage: z.boolean(),
  monthlyHardCap: z.number().int().min(1).max(1_000_000),
});

export const setConversationAiModeSchema = z.object({
  conversationId: uuidSchema,
  mode: z.enum(["auto", "paused"]),
});

const nullableText = (max: number) => z.string().trim().max(max).nullable();

export const searchMenuInputSchema = z.object({ query: nullableText(80) }).strict();

export const updateCartInputSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            menu_item_id: uuidSchema,
            size_id: uuidSchema.nullable(),
            quantity: z.number().int().min(1).max(50),
            notes: nullableText(140),
          })
          .strict(),
      )
      .max(30)
      .nullable(),
    fulfillment: z.enum(["pickup", "delivery"]).nullable(),
    address: z
      .object({
        logradouro: nullableText(120),
        numero: nullableText(20),
        bairro: nullableText(80),
        complemento: nullableText(80),
      })
      .strict()
      .nullable(),
    customer_name: nullableText(120),
  })
  .strict();
export type UpdateCartInput = z.infer<typeof updateCartInputSchema>;

export const handoffInputSchema = z
  .object({
    reason: z.enum([
      "customer_request",
      "complaint",
      "order_change",
      "status_question",
      "unsupported_media",
      "unclear",
      "other",
    ]),
    note: z.string().trim().max(200),
  })
  .strict();

export const emptyToolInputSchema = z.object({}).strict();
