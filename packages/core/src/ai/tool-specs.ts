// The five assistant tools as JSON Schema (12.ai-order-assistant.md "Tools"). Sent to the model
// with strict: true. packages/schemas/src/ai.ts holds the matching Zod schemas that validate input.

import type { AssistantToolSpec } from "../ports/assistant-model";

export const AI_TOOL_NAMES = [
  "search_menu",
  "update_cart",
  "send_order_summary",
  "place_order",
  "handoff_to_human",
] as const;
export type AiToolName = (typeof AI_TOOL_NAMES)[number];

const nullableString = (description: string) => ({ type: ["string", "null"], description });
const noInput = { type: "object", properties: {}, required: [], additionalProperties: false };

export const AI_TOOL_SPECS: readonly AssistantToolSpec[] = [
  {
    name: "search_menu",
    description: "Search today's menu. Use it when the menu in the restaurant block does not answer the question.",
    inputSchema: {
      type: "object",
      properties: { query: nullableString("Words to search in item names, or null for the whole menu.") },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "update_cart",
    description:
      "Record what the customer said. Null fields stay as they are. `items` replaces the whole item list. Returns the cart, totals as BRL text, and `missing`.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: ["array", "null"],
          description: "The full list of items, or null to keep the current list.",
          items: {
            type: "object",
            properties: {
              menu_item_id: { type: "string" },
              size_id: nullableString("The size id, or null when the item has no sizes."),
              quantity: { type: "integer", minimum: 1, maximum: 50 },
              notes: nullableString("A short note such as 'sem cebola', or null."),
            },
            required: ["menu_item_id", "size_id", "quantity", "notes"],
            additionalProperties: false,
          },
        },
        fulfillment: {
          type: ["string", "null"],
          enum: ["pickup", "delivery", null],
          description: "Retirada = pickup, Entrega = delivery.",
        },
        address: {
          type: ["object", "null"],
          properties: {
            logradouro: nullableString("Street name."),
            numero: nullableString("House number."),
            bairro: nullableString("Neighborhood."),
            complemento: nullableString("Apartment, block, or reference."),
          },
          required: ["logradouro", "numero", "bairro", "complemento"],
          additionalProperties: false,
        },
        customer_name: nullableString("The customer's name when they say it, or null."),
      },
      required: ["items", "fulfillment", "address", "customer_name"],
      additionalProperties: false,
    },
  },
  {
    name: "send_order_summary",
    description:
      "Send the order summary to the customer. Call it when `missing` is empty. Then ask the customer to confirm.",
    inputSchema: noInput,
  },
  {
    name: "place_order",
    description: "Create the order. Call it only when the customer's last message confirms the latest summary.",
    inputSchema: noInput,
  },
  {
    name: "handoff_to_human",
    description: "Pass the conversation to a person and stop answering.",
    inputSchema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          enum: [
            "customer_request",
            "complaint",
            "order_change",
            "status_question",
            "unsupported_media",
            "unclear",
            "other",
          ],
        },
        note: { type: "string", maxLength: 200, description: "One sentence for the attendant." },
      },
      required: ["reason", "note"],
      additionalProperties: false,
    },
  },
];
