// covers FR-107, FR-108, FR-146, NFR-022
import { describe, expect, test } from "bun:test";
import {
  invoiceJobSchema,
  outboundMessageJobSchema,
  syncJobSchema,
  uatisFeedPullJobSchema,
  webhookDeliveryJobSchema,
  webhookEnvelopeSchema,
} from "./queues";

const U = "3f6c1a0e-7a3b-4b1e-9c53-1f3f6d0f6a11";
const V = "0d9e2b34-5c11-4e7a-8d2f-6a5b9c0e1f22";

describe('queue wire shapes (05.data-model.md "Queues")', () => {
  test("mt_outbound_messages", () => {
    expect(outboundMessageJobSchema.parse({ v: 1, restaurantId: U, messageId: V })).toEqual({
      v: 1,
      restaurantId: U,
      messageId: V,
    });
    expect(outboundMessageJobSchema.safeParse({ v: 2, restaurantId: U, messageId: V }).success).toBe(false);
    expect(outboundMessageJobSchema.safeParse({ v: 1, restaurantId: U }).success).toBe(false);
  });
  test("mt_webhook_deliveries", () => {
    expect(webhookDeliveryJobSchema.safeParse({ v: 1, restaurantId: U, deliveryId: V }).success).toBe(true);
    expect(webhookDeliveryJobSchema.safeParse({ v: 1, restaurantId: "x", deliveryId: V }).success).toBe(false);
  });
  test("mt_invoice_jobs op is issue, poll, or cancel", () => {
    for (const op of ["issue", "poll", "cancel"]) {
      expect(invoiceJobSchema.safeParse({ v: 1, restaurantId: U, orderInvoiceId: V, op }).success).toBe(true);
    }
    expect(invoiceJobSchema.safeParse({ v: 1, restaurantId: U, orderInvoiceId: V, op: "retry" }).success).toBe(false);
  });
  test("mt_invoice_jobs poll carries its round for the backoff (FR-127)", () => {
    expect(
      invoiceJobSchema.parse({ v: 1, restaurantId: U, orderInvoiceId: V, op: "poll", pollRound: 3 }).pollRound,
    ).toBe(3);
    expect(
      invoiceJobSchema.safeParse({ v: 1, restaurantId: U, orderInvoiceId: V, op: "poll", pollRound: -1 }).success,
    ).toBe(false);
  });
  // covers FR-174 (ADR-023)
  test("mt_sync op uatis_feed_pull has its own schema", () => {
    expect(uatisFeedPullJobSchema.safeParse({ v: 1, restaurantId: U, op: "uatis_feed_pull" }).success).toBe(true);
    expect(uatisFeedPullJobSchema.safeParse({ v: 1, restaurantId: U, op: "whatsapp_reconcile" }).success).toBe(false);
    expect(syncJobSchema.safeParse({ v: 1, restaurantId: U, op: "uatis_feed_pull" }).success).toBe(false);
  });
  test("mt_sync op is whatsapp_reconcile", () => {
    expect(syncJobSchema.safeParse({ v: 1, restaurantId: U, op: "whatsapp_reconcile" }).success).toBe(true);
    expect(syncJobSchema.safeParse({ v: 1, restaurantId: U, op: "poll_invoice" }).success).toBe(false);
  });
});

describe("outbound webhook envelope (06.api-spec.md)", () => {
  const env = {
    id: U,
    type: "order.created",
    created_at: "2026-10-13T12:00:00Z",
    restaurant_id: V,
    data: { order: { id: U } },
  };
  test("accepts the documented envelope", () => {
    expect(webhookEnvelopeSchema.safeParse(env).success).toBe(true);
  });
  test("rejects unknown events and non-object data", () => {
    expect(webhookEnvelopeSchema.safeParse({ ...env, type: "order.deleted" }).success).toBe(false);
    expect(webhookEnvelopeSchema.safeParse({ ...env, data: "x" }).success).toBe(false);
  });
});

describe("retry attempt counter (ADR-007, FR-108)", () => {
  test("every job shape accepts an optional attempt number from 1 to 6", () => {
    expect(outboundMessageJobSchema.parse({ v: 1, restaurantId: U, messageId: V, attempt: 3 }).attempt).toBe(3);
    expect(syncJobSchema.parse({ v: 1, restaurantId: U, op: "whatsapp_reconcile", attempt: 6 }).attempt).toBe(6);
    expect(webhookDeliveryJobSchema.parse({ v: 1, restaurantId: U, deliveryId: V, attempt: 2 }).attempt).toBe(2);
    expect(invoiceJobSchema.parse({ v: 1, restaurantId: U, orderInvoiceId: V, op: "poll", attempt: 2 }).attempt).toBe(
      2,
    );
    expect(outboundMessageJobSchema.safeParse({ v: 1, restaurantId: U, messageId: V, attempt: 0 }).success).toBe(false);
    expect(outboundMessageJobSchema.safeParse({ v: 1, restaurantId: U, messageId: V, attempt: 7 }).success).toBe(false);
  });
});
