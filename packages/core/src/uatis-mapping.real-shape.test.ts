// covers FR-104, FR-105, FR-107, ADR-002 Amendment 2 (the real backend-uatis content shape)
import { describe, expect, test } from "bun:test";
import { mapUatisMessage, tryMapUatisMessage, UNSUPPORTED_MEDIA_BODY } from "./uatis-mapping";

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
