// covers FR-104, FR-105, FR-107, ADR-002 Amendment 2 and 4 (the real backend-uatis content shape)
import { describe, expect, test } from "bun:test";
import { mapUatisMessage, parseUatisWebhookEvent, tryMapUatisMessage, UNSUPPORTED_MEDIA_BODY } from "./uatis-mapping";

// The row shape backend-uatis actually stores and returns (packages/http/src/services/send.ts
// `outgoingContent`, supabase/functions/_shared/auto-reply-evaluate.ts): `text` is a string.
const realRow = {
  id: "3f0c1b8e-0000-4000-8000-000000000001",
  conversation_id: "3f0c1b8e-0000-4000-8000-000000000002",
  direction: "in",
  content: { version: "1", type: "text", kind: "text", text: "Oi, tem marmita?" },
  status: { state: "received", errors: [] },
  external_id: "wamid.HBg",
  contact_address: "5511999999999",
  created_at: "2026-10-13T12:00:00.000Z",
};

describe("mapUatisMessage with the stored backend-uatis shape", () => {
  test("reads a text body stored as a plain string", () => {
    const m = mapUatisMessage(realRow);
    expect(m.body).toBe("Oi, tem marmita?");
    expect(m.contentType).toBe("text");
  });

  test("still reads the documented { text: { body } } shape", () => {
    const m = mapUatisMessage({ ...realRow, content: { type: "text", text: { body: "Olá" } } });
    expect(m.body).toBe("Olá");
  });

  test("a file message with a caption is still unsupported media", () => {
    const m = mapUatisMessage({
      ...realRow,
      content: { version: "1", type: "file", kind: "image", file: { uri: "x" }, text: "legenda" },
    });
    expect(m.body).toBe(UNSUPPORTED_MEDIA_BODY);
    expect(m.contentType).toBe("unsupported");
  });

  test("a location picked on the map keeps its name, address, and a Maps link", () => {
    const m = mapUatisMessage({
      ...realRow,
      content: {
        version: "1",
        type: "data",
        kind: "location",
        data: {
          latitude: -23.5505,
          longitude: -46.6333,
          name: "Av. Paulista",
          address: "Av. Paulista, 1000 - São Paulo",
          url: "https://example.com",
        },
      },
    });
    expect(m.body).toBe(
      "📍 Av. Paulista - Av. Paulista, 1000 - São Paulo\nhttps://www.google.com/maps?q=-23.5505,-46.6333",
    );
    expect(m.contentType).toBe("location");
  });

  test("a current-position share has coordinates only", () => {
    const m = mapUatisMessage({
      ...realRow,
      content: { version: "1", type: "data", kind: "location", data: { latitude: -23.5, longitude: -46.6 } },
    });
    expect(m.body).toBe("📍 Localização\nhttps://www.google.com/maps?q=-23.5,-46.6");
    expect(m.contentType).toBe("location");
  });

  test("a location without finite coordinates and live location stay unsupported media", () => {
    for (const content of [
      { version: "1", type: "data", kind: "location", data: { latitude: "x", longitude: -46.6 } },
      { version: "1", type: "data", kind: "location", data: { latitude: Number.NaN, longitude: -46.6 } },
      { version: "1", type: "data", kind: "location" },
      { version: "1", type: "data", kind: "unsupported" },
      { version: "1", type: "data", kind: "order", data: { latitude: 1, longitude: 2 } },
    ]) {
      const m = mapUatisMessage({ ...realRow, content });
      expect(m.body).toBe(UNSUPPORTED_MEDIA_BODY);
      expect(m.contentType).toBe("unsupported");
    }
  });

  test("an empty text body is unsupported (messages.body needs 1-4096 characters)", () => {
    const m = mapUatisMessage({ ...realRow, content: { type: "text", text: "" } });
    expect(m.body).toBe(UNSUPPORTED_MEDIA_BODY);
  });

  test("a body longer than 4096 characters is cut to 4096", () => {
    const m = mapUatisMessage({ ...realRow, content: { type: "text", text: "a".repeat(5000) } });
    expect(m.body.length).toBe(4096);
  });
});

describe("tryMapUatisMessage", () => {
  test("returns null for the internal direction (agent tool traffic)", () => {
    expect(tryMapUatisMessage({ ...realRow, direction: "internal" })).toBeNull();
  });

  test("maps in and out rows", () => {
    expect(tryMapUatisMessage(realRow)?.direction).toBe("in");
    expect(tryMapUatisMessage({ ...realRow, direction: "out" })?.direction).toBe("out");
  });

  test("still throws on a malformed row", () => {
    expect(() => tryMapUatisMessage({ ...realRow, id: "" })).toThrow();
  });
});

// covers FR-175, FR-177 (ADR-021): the exact body the backend-uatis worker posts
// (its apps/worker/src/body.ts over the `enqueue_webhook_delivery` snapshot).
describe("parseUatisWebhookEvent with the backend-uatis worker body", () => {
  const envelope = (message: Record<string, unknown>, type = "message.created") => ({
    id: "5b0d7d1e-2a4c-4d43-9a39-7f0f2b9d6c11",
    type,
    created_at: "2026-10-14T12:00:00.412+00:00",
    organization_id: "0f8f5c2e-6a51-4c1b-9f0b-2d2c1f3e4a5b",
    data: { message },
  });
  const snapshot = {
    id: "8c1e2a9b-3f4d-4e5a-8b6c-7d8e9f0a1b2c",
    conversation_id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    direction: "in",
    content: { version: "1", type: "text", kind: "text", text: "Oi, tem marmita hoje?" },
    status: { state: "received", errors: [] },
    contact_address: "5511999999999",
    created_at: "2026-10-14T12:00:00.398+00:00",
  };

  test("reads organization_id, the message, and normalizes the address", () => {
    const e = parseUatisWebhookEvent(envelope(snapshot));
    expect(e.type).toBe("message.created");
    if (e.type !== "message.created") throw new Error("unreachable");
    expect(e.organizationId).toBe("0f8f5c2e-6a51-4c1b-9f0b-2d2c1f3e4a5b");
    expect(e.message.externalId).toBe(snapshot.id);
    expect(e.message.contactAddress).toBe("+5511999999999");
    expect(e.message.body).toBe("Oi, tem marmita hoje?");
    expect(e.message.status).toBe("delivered");
    expect(e.message.failure).toBeNull();
  });

  test("an internal row is ignored, not a 422", () => {
    const e = parseUatisWebhookEvent(envelope({ ...snapshot, direction: "internal", contact_address: null }));
    expect(e).toEqual({
      type: "ignored",
      eventType: "message.created",
      organizationId: "0f8f5c2e-6a51-4c1b-9f0b-2d2c1f3e4a5b",
    });
  });

  test("a failed outbound update carries the first error", () => {
    const e = parseUatisWebhookEvent(
      envelope(
        {
          ...snapshot,
          direction: "out",
          content: {},
          status: {
            state: "failed",
            errors: [{ code: 131047, title: "Re-engagement message", message: "More than 24 hours", details: null }],
          },
        },
        "message.updated",
      ),
    );
    if (e.type !== "message.updated") throw new Error("unreachable");
    expect(e.message.status).toBe("failed");
    expect(e.message.failure).toEqual({ code: "whatsapp_131047", message: "Re-engagement message" });
  });

  test("a failed state with no errors gets whatsapp_failed", () => {
    const e = parseUatisWebhookEvent(
      envelope({ ...snapshot, direction: "out", status: { state: "failed", errors: [] } }, "message.updated"),
    );
    if (e.type !== "message.updated") throw new Error("unreachable");
    expect(e.message.failure).toEqual({ code: "whatsapp_failed", message: null });
  });

  test("an unknown outbound state (accepted) maps to null", () => {
    const e = parseUatisWebhookEvent(
      envelope({ ...snapshot, direction: "out", status: { state: "accepted", errors: [] } }, "message.updated"),
    );
    if (e.type !== "message.updated") throw new Error("unreachable");
    expect(e.message.status).toBeNull();
  });

  test("conversation.updated keeps organization_id", () => {
    const e = parseUatisWebhookEvent({ ...envelope(snapshot, "conversation.updated"), data: { conversation: {} } });
    expect(e).toEqual({ type: "conversation.updated", organizationId: "0f8f5c2e-6a51-4c1b-9f0b-2d2c1f3e4a5b" });
  });

  test("a missing organization_id is null", () => {
    const { organization_id: _, ...rest } = envelope(snapshot);
    const e = parseUatisWebhookEvent(rest);
    if (e.type !== "message.created") throw new Error("unreachable");
    expect(e.organizationId).toBeNull();
  });
});
