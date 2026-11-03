// covers FR-192, FR-198, FR-218
import { describe, expect, test } from "bun:test";

import { HANDBACK_MARKER, type HistoryRow, historyToMessages, splitTrailingAssistant } from "./history";

const row = (p: Partial<HistoryRow>): HistoryRow => ({
  direction: "in",
  body: "oi",
  automaticKind: null,
  sentByUser: false,
  aiRunId: null,
  ...p,
});

describe("historyToMessages", () => {
  test("a hand-off reply carries the hand-back marker; other replies do not (FR-218)", () => {
    const text = (m: ReturnType<typeof historyToMessages>[number]) =>
      m.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const out = historyToMessages([
      row({ body: "Entrega" }),
      row({ direction: "out", body: "Qual é o nome da rua?", aiRunId: "r1" }),
      row({ body: "[mídia não suportada]" }),
      row({ direction: "out", body: "Um atendente vai continuar.", aiRunId: "r2", handedOff: true }),
      row({ body: "Rua A, 39" }),
    ]);
    expect(text(out[1]!)).not.toContain(HANDBACK_MARKER);
    expect(text(out[3]!)).toBe(`Um atendente vai continuar.\n${HANDBACK_MARKER}`);
  });

  test("inbound is user, AI outbound is assistant, same roles merge", () => {
    const out = historyToMessages([
      row({ body: "quero 2 marmitas" }),
      row({ body: "de frango" }),
      row({ direction: "out", body: "Retirada ou entrega?", aiRunId: "r1" }),
      row({ body: "entrega" }),
    ]);
    expect(out).toEqual([
      { role: "user", content: [{ type: "text", text: "quero 2 marmitas\nde frango" }] },
      { role: "assistant", content: [{ type: "text", text: "Retirada ou entrega?" }] },
      { role: "user", content: [{ type: "text", text: "entrega" }] },
    ]);
  });
  test("attendant and automatic messages carry a prefix", () => {
    const out = historyToMessages([
      row({ body: "oi" }),
      row({ direction: "out", body: "Bem-vindo!", automaticKind: "welcome" }),
      row({ direction: "out", body: "Já te atendo", sentByUser: true }),
      row({ body: "ok" }),
    ]);
    expect(out[1]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "[mensagem automática] Bem-vindo!\n[atendente] Já te atendo" }],
    });
  });
  test("leading assistant turns are dropped so the list starts with user", () => {
    const out = historyToMessages([
      row({ direction: "out", body: "promo", automaticKind: "welcome" }),
      row({ body: "oi" }),
    ]);
    expect(out[0]?.role).toBe("user");
    expect(out).toHaveLength(1);
  });
  test("keeps only the last 20 rows", () => {
    const rows = Array.from({ length: 30 }, (_, n) =>
      row({ body: `m${n}`, direction: n % 2 ? "out" : "in", aiRunId: "r" }),
    );
    const text = historyToMessages(rows).flatMap((m) => m.content.map((b) => (b.type === "text" ? b.text : "")));
    expect(text[0]).toBe("m10");
  });
});

describe("splitTrailingAssistant", () => {
  const user = (text: string) => ({ role: "user" as const, content: [{ type: "text" as const, text }] });
  const assistant = (text: string) => ({ role: "assistant" as const, content: [{ type: "text" as const, text }] });
  test("no trailing assistant turn: unchanged, null text", () => {
    const msgs = [user("oi"), assistant("Olá"), user("quero 1")];
    expect(splitTrailingAssistant(msgs)).toEqual({ messages: msgs, trailingAssistantText: null });
  });
  test("a trailing automatic turn is removed and its text returned", () => {
    const welcome = assistant("[mensagem automática] Bem-vindo!");
    expect(splitTrailingAssistant([user("oi"), welcome])).toEqual({
      messages: [user("oi")],
      trailingAssistantText: "[mensagem automática] Bem-vindo!",
    });
  });
  test("several trailing assistant turns join with a newline", () => {
    expect(splitTrailingAssistant([user("oi"), assistant("a"), assistant("b")]).trailingAssistantText).toBe("a\nb");
  });
  test("all-assistant input gives no messages", () => {
    expect(splitTrailingAssistant([assistant("a")]).messages).toEqual([]);
  });
});
