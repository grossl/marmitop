// covers FR-014, FR-117, FR-143
import { describe, expect, test } from "bun:test";
import { sendMessageActionSchema, sendMessageBodySchema } from "./messages";

const U1 = "3f6c1a0e-7a3b-4b1e-9c53-1f3f6d0f6a11";
const U2 = "0d9e2b34-5c11-4e7a-8d2f-6a5b9c0e1f22";

describe("sendMessageBodySchema (POST /v1/messages)", () => {
  test("customer_id and body, optional order_id", () => {
    expect(sendMessageBodySchema.parse({ customer_id: U1, body: "Seu pedido saiu." })).toEqual({
      customer_id: U1,
      body: "Seu pedido saiu.",
    });
    expect(sendMessageBodySchema.parse({ customer_id: U1, body: "oi", order_id: U2 }).order_id).toBe(U2);
  });
  test("a blank body sends nothing (FR-014); 4096 characters is the limit", () => {
    expect(sendMessageBodySchema.safeParse({ customer_id: U1, body: "   " }).success).toBe(false);
    expect(sendMessageBodySchema.safeParse({ customer_id: U1, body: "" }).success).toBe(false);
    expect(sendMessageBodySchema.safeParse({ customer_id: U1, body: "x".repeat(4096) }).success).toBe(true);
    expect(sendMessageBodySchema.safeParse({ customer_id: U1, body: "x".repeat(4097) }).success).toBe(false);
  });
  test("unknown keys are rejected", () => {
    expect(sendMessageBodySchema.safeParse({ customer_id: U1, body: "oi", status: "sent" }).success).toBe(false);
  });
});

describe("sendMessageActionSchema", () => {
  test("conversationId, body, optional orderId", () => {
    expect(sendMessageActionSchema.safeParse({ conversationId: U1, body: "oi", orderId: U2 }).success).toBe(true);
    expect(sendMessageActionSchema.safeParse({ conversationId: U1, body: "\n " }).success).toBe(false);
  });
});
