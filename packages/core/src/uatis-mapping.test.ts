// covers FR-101, FR-102, FR-104, FR-105, FR-106, ADR-002
import { describe, expect, test } from "bun:test";
import { AppError } from "./errors";
import {
  buildUatisSendTemplateBody,
  buildUatisSendTextBody,
  mapUatisMessage,
  nextMessageStatus,
  parseUatisSendResponse,
  parseUatisWebhookEvent,
  UNSUPPORTED_MEDIA_BODY,
} from "./uatis-mapping";

const inboundEvent = {
  id: "delivery-uuid",
  type: "message.created",
  created_at: "2026-10-13T12:00:00Z",
  organization_id: "org-1",
  data: {
    message: {
      id: "msg-1",
      conversation_id: "conv-1",
      direction: "in",
      content: { type: "text", text: { body: "Oi" } },
      status: { state: "received" },
      contact_address: "+5511999999999",
      created_at: "2026-10-13T12:00:00Z",
    },
  },
};

function catchError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (e) {
    return e as AppError;
  }
  throw new Error("expected an error");
}

describe("parseUatisWebhookEvent", () => {
  test("maps an inbound message.created to the internal shape", () => {
    const e = parseUatisWebhookEvent(inboundEvent);
    expect(e).toEqual({
      type: "message.created",
      deliveryId: "delivery-uuid",
      occurredAt: new Date("2026-10-13T12:00:00Z"),
      message: {
        externalId: "msg-1",
        conversationExternalId: "conv-1",
        direction: "in",
        body: "Oi",
        contentType: "text",
        // backend-uatis reports inbound as "received"; Marmitop stores "delivered" (ADR-002 Amendment 1)
        status: "delivered",
        contactAddress: "+5511999999999",
        createdAt: new Date("2026-10-13T12:00:00Z"),
      },
    });
  });
  test("maps message.updated with the new state", () => {
    const e = parseUatisWebhookEvent({
      ...inboundEvent,
      type: "message.updated",
      data: {
        message: { ...inboundEvent.data.message, direction: "out", status: { state: "read" } },
      },
    });
    expect(e.type).toBe("message.updated");
    if (e.type === "message.updated") {
      expect(e.message.status).toBe("read");
      expect(e.message.direction).toBe("out");
    }
  });
  test("conversation.updated is accepted and ignored", () => {
    expect(
      parseUatisWebhookEvent({
        id: "x",
        type: "conversation.updated",
        created_at: "2026-10-13T12:00:00Z",
        data: { conversation: { id: "c" } },
      }),
    ).toEqual({ type: "conversation.updated" });
  });
  test("an unknown event type is accepted and ignored", () => {
    expect(parseUatisWebhookEvent({ id: "x", type: "template.updated", data: {} })).toEqual({
      type: "ignored",
      eventType: "template.updated",
    });
  });
  test("a malformed payload is a validation error", () => {
    for (const bad of [
      null,
      "x",
      42,
      [],
      {},
      { type: "message.created" },
      { type: "message.created", data: {} },
      { type: "message.created", data: { message: { id: "" } } },
    ]) {
      const err = catchError(() => parseUatisWebhookEvent(bad));
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe("validation_failed");
    }
  });
});

describe("mapUatisMessage (webhook and poll share it)", () => {
  const base = inboundEvent.data.message;
  test("non-text content becomes the unsupported-media placeholder", () => {
    for (const content of [
      { type: "image", image: { url: "x" } },
      { type: "audio" },
      { type: "text" },
      { type: "text", text: {} },
      { type: "text", text: { body: 42 } },
      undefined,
    ]) {
      const m = mapUatisMessage({ ...base, content });
      expect(m.body).toBe(UNSUPPORTED_MEDIA_BODY);
      expect(m.contentType).toBe("unsupported");
    }
    expect(UNSUPPORTED_MEDIA_BODY).toBe("[mídia não suportada]");
  });
  test("state mapping is one to one, received becomes delivered, unknown state is null", () => {
    const state = (s: unknown) => mapUatisMessage({ ...base, status: { state: s } }).status;
    expect(state("pending")).toBe("pending");
    expect(state("sent")).toBe("sent");
    expect(state("delivered")).toBe("delivered");
    expect(state("read")).toBe("read");
    expect(state("failed")).toBe("failed");
    expect(state("received")).toBe("delivered");
    expect(state("weird")).toBeNull();
    expect(mapUatisMessage({ ...base, status: undefined }).status).toBeNull();
  });
  test("normalizes the contact address to E.164 and tolerates a missing one", () => {
    expect(mapUatisMessage({ ...base, contact_address: "5511999999999" }).contactAddress).toBe("+5511999999999");
    expect(mapUatisMessage({ ...base, contact_address: undefined }).contactAddress).toBeNull();
  });
  test("rejects a bad direction or timestamp", () => {
    expect(catchError(() => mapUatisMessage({ ...base, direction: "sideways" })).code).toBe("validation_failed");
    expect(catchError(() => mapUatisMessage({ ...base, created_at: "not a date" })).code).toBe("validation_failed");
  });
  test("conversation id is optional", () => {
    expect(mapUatisMessage({ ...base, conversation_id: undefined }).conversationExternalId).toBeNull();
  });
});

describe("nextMessageStatus (FR-106: never backward)", () => {
  test("moves forward only", () => {
    expect(nextMessageStatus("pending", "sent")).toBe("sent");
    expect(nextMessageStatus("sent", "delivered")).toBe("delivered");
    expect(nextMessageStatus("delivered", "read")).toBe("read");
    expect(nextMessageStatus("pending", "read")).toBe("read");
  });
  test("an older event keeps the highest status", () => {
    expect(nextMessageStatus("read", "sent")).toBe("read");
    expect(nextMessageStatus("delivered", "sent")).toBe("delivered");
    expect(nextMessageStatus("delivered", "pending")).toBe("delivered");
    expect(nextMessageStatus("sent", "sent")).toBe("sent");
  });
  test("failed is reachable from pending and sent only, and is final", () => {
    expect(nextMessageStatus("pending", "failed")).toBe("failed");
    expect(nextMessageStatus("sent", "failed")).toBe("failed");
    expect(nextMessageStatus("delivered", "failed")).toBe("delivered");
    expect(nextMessageStatus("read", "failed")).toBe("read");
    expect(nextMessageStatus("failed", "delivered")).toBe("failed");
  });
  test("a null incoming status changes nothing", () => {
    expect(nextMessageStatus("sent", null)).toBe("sent");
  });
});

describe("send bodies and response (ADR-002 Amendment 1)", () => {
  test("text body carries from_address = phone_number_id", () => {
    expect(buildUatisSendTextBody({ to: "+5511999999999", fromAddress: "pn-1", body: "Olá!" })).toEqual({
      to: "+5511999999999",
      from_address: "pn-1",
      text: { body: "Olá!" },
    });
  });
  test("template body", () => {
    expect(
      buildUatisSendTemplateBody({
        to: "+5511999999999",
        fromAddress: "pn-1",
        templateName: "pedido",
        language: "pt_BR",
      }),
    ).toEqual({
      to: "+5511999999999",
      from_address: "pn-1",
      template: { name: "pedido", language: "pt_BR", components: [] },
    });
  });
  test("parses the 201 response", () => {
    expect(
      parseUatisSendResponse({ id: "u-1", conversation_id: "c", direction: "out", status: { state: "pending" } }),
    ).toEqual({
      externalId: "u-1",
      status: "pending",
    });
    expect(catchError(() => parseUatisSendResponse({})).code).toBe("upstream_error");
  });
});
