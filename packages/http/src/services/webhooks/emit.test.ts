// covers FR-146, FR-147, 06.api-spec.md "Outbound webhooks" (envelope)
import { describe, expect, test } from "bun:test";
import { webhookEnvelopeSchema } from "@mt/schemas";

import { buildEventEnvelope, isWebhookEvent } from "./emit";

const R = "3f6c1a0e-7a3b-4b1e-9c53-1f3f6d0f6a11";
const D = "0d9e2b34-5c11-4e7a-8d2f-6a5b9c0e1f22";

describe("buildEventEnvelope", () => {
  test("wraps data in the 06 envelope with the delivery id as id", () => {
    const env = buildEventEnvelope({
      deliveryId: D,
      type: "order.status_changed",
      restaurantId: R,
      createdAt: new Date("2026-10-13T12:00:00Z"),
      data: { order_id: "x", code: "ORD-001" },
    });
    expect(env).toEqual({
      id: D,
      type: "order.status_changed",
      created_at: "2026-10-13T12:00:00.000Z",
      restaurant_id: R,
      data: { order_id: "x", code: "ORD-001" },
    });
    expect(webhookEnvelopeSchema.safeParse(env).success).toBe(true);
  });
});

describe("isWebhookEvent", () => {
  test("accepts the four events of FR-146 and nothing else", () => {
    for (const e of ["order.created", "order.status_changed", "message.received", "invoice.updated"]) {
      expect(isWebhookEvent(e)).toBe(true);
    }
    expect(isWebhookEvent("order.deleted")).toBe(false);
  });
});
