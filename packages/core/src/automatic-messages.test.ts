// covers FR-110, FR-111, FR-112, FR-114, FR-115, FR-117, FR-241
import { describe, expect, test } from "bun:test";
import {
  type AutomaticMessageConfig,
  type AutomaticMessagesConfig,
  CLOSED_NOTICE_INTERVAL_MS,
  decideInboundAutoMessage,
  decideOrderReceived,
  ORDER_STATUS_MESSAGE_KINDS,
  renderMessage,
} from "./automatic-messages";
import type { BusinessHoursRow } from "./business-hours";

const SP = "America/Sao_Paulo";
const hours: BusinessHoursRow[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  enabled: true,
  opensAt: "09:00",
  closesAt: "18:00",
}));
const cfg = (over: Partial<Record<"welcome" | "closed" | "order_received", Partial<AutomaticMessageConfig>>> = {}) =>
  ({
    welcome: {
      enabled: true,
      body: "Oi {{nome}}, bem-vindo ao {{restaurante}}!",
      templateName: null,
      templateLanguage: null,
      ...over.welcome,
    },
    closed: {
      enabled: true,
      body: "Fechado agora, {{nome}}.",
      templateName: null,
      templateLanguage: null,
      ...over.closed,
    },
    order_received: {
      enabled: true,
      body: "Pedido {{pedido}} recebido, {{nome}}!",
      templateName: null,
      templateLanguage: null,
      ...over.order_received,
    },
    // ADR-026 status kinds: off, and not read by the decisions under test here.
    ...Object.fromEntries(
      ORDER_STATUS_MESSAGE_KINDS.map((k) => [
        k,
        { enabled: false, body: "x", templateName: null, templateLanguage: null },
      ]),
    ),
  }) as AutomaticMessagesConfig;
const OPEN = new Date("2026-10-12T15:00:00Z"); // Monday 12:00 local
const CLOSED = new Date("2026-10-12T23:30:00Z"); // Monday 20:30 local
const base = {
  direction: "in" as const,
  isNewConversation: false,
  closedNoticeSentAt: null as Date | null,
  hours,
  timezone: SP,
  customerName: "Ana",
  restaurantName: "Marmitop Centro",
};

describe("renderMessage (FR-115)", () => {
  test("replaces the three variables, leaves unknown ones as text", () => {
    expect(
      renderMessage("Oi {{nome}} do {{restaurante}} {{pedido}} {{outra}}", {
        nome: "Ana",
        restaurante: "X",
        pedido: "ORD-1",
      }),
    ).toBe("Oi Ana do X ORD-1 {{outra}}");
  });
  test("replaces every occurrence and tolerates inner spaces", () => {
    expect(renderMessage("{{nome}} {{ nome }} {{nome}}", { nome: "Ana" })).toBe("Ana Ana Ana");
  });
  test("a variable with no value stays as text", () => {
    expect(renderMessage("Pedido {{pedido}}", { nome: "Ana" })).toBe("Pedido {{pedido}}");
  });
  test("does not re-expand a value that looks like a variable", () => {
    expect(renderMessage("{{nome}}", { nome: "{{restaurante}}", restaurante: "X" })).toBe("{{restaurante}}");
  });
});

describe("decideInboundAutoMessage: welcome", () => {
  test("first message of a new conversation while open sends welcome", () => {
    const d = decideInboundAutoMessage({ ...base, now: OPEN, isNewConversation: true, config: cfg() });
    expect(d).toEqual({ kind: "welcome", body: "Oi Ana, bem-vindo ao Marmitop Centro!" });
  });
  test("the second inbound message sends none", () => {
    expect(decideInboundAutoMessage({ ...base, now: OPEN, isNewConversation: false, config: cfg() })).toBeNull();
  });
  test("a disabled welcome sends none", () => {
    const d = decideInboundAutoMessage({
      ...base,
      now: OPEN,
      isNewConversation: true,
      config: cfg({ welcome: { enabled: false } }),
    });
    expect(d).toBeNull();
  });
});

describe("decideInboundAutoMessage: closed (12-hour rule, ADR-015)", () => {
  test("closed and never notified: sends closed", () => {
    const d = decideInboundAutoMessage({ ...base, now: CLOSED, config: cfg() });
    expect(d).toEqual({ kind: "closed", body: "Fechado agora, Ana." });
  });
  test("three messages at night give one reply", () => {
    let notified: Date | null = null;
    let sent = 0;
    for (const minutes of [0, 10, 40]) {
      const now = new Date(CLOSED.getTime() + minutes * 60_000);
      const d = decideInboundAutoMessage({ ...base, now, closedNoticeSentAt: notified, config: cfg() });
      if (d?.kind === "closed") {
        sent++;
        notified = now;
      }
    }
    expect(sent).toBe(1);
  });
  test("exactly 12 hours later (still closed) sends again; just under does not", () => {
    const sentAt = new Date("2026-10-12T21:00:00Z"); // Mon 18:00 local... but closed from 18:00
    const justUnder = new Date(sentAt.getTime() + CLOSED_NOTICE_INTERVAL_MS - 1);
    const exactly = new Date(sentAt.getTime() + CLOSED_NOTICE_INTERVAL_MS); // Tue 06:00 local, closed
    expect(decideInboundAutoMessage({ ...base, now: justUnder, closedNoticeSentAt: sentAt, config: cfg() })).toBeNull();
    expect(decideInboundAutoMessage({ ...base, now: exactly, closedNoticeSentAt: sentAt, config: cfg() })?.kind).toBe(
      "closed",
    );
  });
  test("the next night sends another", () => {
    const lastNight = CLOSED;
    const nextNight = new Date(CLOSED.getTime() + 24 * 3_600_000);
    expect(
      decideInboundAutoMessage({ ...base, now: nextNight, closedNoticeSentAt: lastNight, config: cfg() })?.kind,
    ).toBe("closed");
  });
  test("open restaurant sends no closed message; disabled closed sends none", () => {
    expect(decideInboundAutoMessage({ ...base, now: OPEN, config: cfg() })).toBeNull();
    expect(decideInboundAutoMessage({ ...base, now: CLOSED, config: cfg({ closed: { enabled: false } }) })).toBeNull();
  });
  test("new conversation while closed sends closed only, not welcome", () => {
    const d = decideInboundAutoMessage({ ...base, now: CLOSED, isNewConversation: true, config: cfg() });
    expect(d?.kind).toBe("closed");
  });
  test("new conversation while closed with closed disabled falls back to welcome", () => {
    const d = decideInboundAutoMessage({
      ...base,
      now: CLOSED,
      isNewConversation: true,
      config: cfg({ closed: { enabled: false } }),
    });
    expect(d?.kind).toBe("welcome");
  });
});

describe("decideInboundAutoMessage: outbound-only", () => {
  test("an outbound message never triggers an automatic message", () => {
    expect(
      decideInboundAutoMessage({ ...base, direction: "out", now: CLOSED, isNewConversation: true, config: cfg() }),
    ).toBeNull();
  });
});

describe("decideOrderReceived (FR-112, FR-117, ADR-014)", () => {
  const order = {
    now: OPEN,
    hasConversation: true,
    orderCode: "ORD-042",
    customerName: "Ana",
    restaurantName: "Marmitop Centro",
  };
  const hoursAgo = (h: number) => new Date(OPEN.getTime() - h * 3_600_000);

  test("inside the window: free text with variables replaced", () => {
    const d = decideOrderReceived({ ...order, lastInboundAt: hoursAgo(2), config: cfg() });
    expect(d).toEqual({ action: "send_text", kind: "order_received", body: "Pedido ORD-042 recebido, Ana!" });
  });
  test("outside the window with a template: template", () => {
    const d = decideOrderReceived({
      ...order,
      lastInboundAt: hoursAgo(30),
      config: cfg({ order_received: { templateName: "pedido_recebido", templateLanguage: "pt_BR" } }),
    });
    expect(d).toEqual({
      action: "send_template",
      kind: "order_received",
      body: "Pedido ORD-042 recebido, Ana!",
      templateName: "pedido_recebido",
      templateLanguage: "pt_BR",
    });
  });
  test("outside the window without a template: failed with outside_service_window", () => {
    const d = decideOrderReceived({ ...order, lastInboundAt: hoursAgo(30), config: cfg() });
    expect(d).toEqual({
      action: "fail",
      kind: "order_received",
      body: "Pedido ORD-042 recebido, Ana!",
      errorCode: "outside_service_window",
    });
  });
  test("an order confirmed at creation gets the fixed text by fulfillment (FR-241, ADR-036)", () => {
    const at = { ...order, lastInboundAt: hoursAgo(1), config: cfg() };
    expect(decideOrderReceived({ ...at, confirmedFor: "pickup" })).toEqual({
      action: "send_text",
      kind: "order_received",
      body: "Recebemos seu pedido! Avisaremos quando seu pedido estiver pronto.",
    });
    expect(decideOrderReceived({ ...at, confirmedFor: "delivery" })).toMatchObject({
      body: "Recebemos seu pedido! Avisaremos quando seu pedido for enviado.",
    });
    expect(decideOrderReceived({ ...at, confirmedFor: null })).toMatchObject({ body: "Pedido ORD-042 recebido, Ana!" });
  });
  test("the confirmed text still follows the switch and the 24-hour window", () => {
    expect(
      decideOrderReceived({
        ...order,
        lastInboundAt: hoursAgo(1),
        confirmedFor: "pickup",
        config: cfg({ order_received: { enabled: false } }),
      }),
    ).toEqual({ action: "skip", reason: "disabled" });
    expect(
      decideOrderReceived({ ...order, lastInboundAt: hoursAgo(30), confirmedFor: "delivery", config: cfg() }),
    ).toMatchObject({ action: "fail", errorCode: "outside_service_window" });
  });
  test("a counter order with no conversation sends none", () => {
    expect(decideOrderReceived({ ...order, hasConversation: false, lastInboundAt: null, config: cfg() })).toEqual({
      action: "skip",
      reason: "no_conversation",
    });
  });
  test("disabled sends none", () => {
    expect(
      decideOrderReceived({
        ...order,
        lastInboundAt: hoursAgo(1),
        config: cfg({ order_received: { enabled: false } }),
      }),
    ).toEqual({ action: "skip", reason: "disabled" });
  });
});
