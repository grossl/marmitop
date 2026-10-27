// covers FR-200, FR-201, FR-202, FR-203, FR-204, FR-205, FR-115, FR-117, ADR-026, ADR-028
import { describe, expect, test } from "bun:test";
import {
  type AutomaticMessageConfig,
  type AutomaticMessagesConfig,
  decideOrderStatusMessage,
  ORDER_STATUS_MESSAGE_KINDS,
  type OrderStatusMessageInput,
  orderStatusMessageKind,
} from "./automatic-messages";
import { isForwardOrCancel } from "./order-status";

const off: AutomaticMessageConfig = { enabled: false, body: "x", templateName: null, templateLanguage: null };
const on = (body: string, over: Partial<AutomaticMessageConfig> = {}): AutomaticMessageConfig => ({
  enabled: true,
  body,
  templateName: null,
  templateLanguage: null,
  ...over,
});
const config = (over: Partial<AutomaticMessagesConfig> = {}): AutomaticMessagesConfig => ({
  welcome: off,
  closed: off,
  order_received: off,
  order_confirmed: on("Olá {{nome}}! Pedido {{pedido}} confirmado."),
  order_ready: on("Pedido {{pedido}} pronto no {{restaurante}}."),
  order_out_for_delivery: on("Pedido {{pedido}} saiu."),
  order_cancelled: on("Pedido {{pedido}} cancelado."),
  ...over,
});

const NOW = new Date("2026-10-13T15:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const base: OrderStatusMessageInput = {
  config: config(),
  from: "aguardando",
  to: "confirmado",
  fulfillment: "delivery",
  hasConversation: true,
  alreadySent: false,
  lastInboundAt: hoursAgo(1),
  now: NOW,
  orderCode: "ORD-042",
  customerName: "Ana",
  restaurantName: "Marmitop Centro",
};

describe("ORDER_STATUS_MESSAGE_KINDS (FR-200)", () => {
  test("four kinds, one per target status; finalizado has none (ADR-028)", () => {
    expect(ORDER_STATUS_MESSAGE_KINDS).toEqual([
      "order_confirmed",
      "order_ready",
      "order_out_for_delivery",
      "order_cancelled",
    ]);
  });
});

describe("isForwardOrCancel (ADR-017, ADR-026)", () => {
  test("forward moves and skips are forward; a back step and a no-op are not", () => {
    expect(isForwardOrCancel("aguardando", "confirmado", "delivery")).toBe(true);
    expect(isForwardOrCancel("aguardando", "saiu", "delivery")).toBe(true);
    expect(isForwardOrCancel("pronto", "finalizado", "pickup")).toBe(true);
    expect(isForwardOrCancel("pronto", "confirmado", "delivery")).toBe(false);
    expect(isForwardOrCancel("pronto", "pronto", "pickup")).toBe(false);
  });
  test("cancel from a non-final status is a forward move; from a final status it is not", () => {
    expect(isForwardOrCancel("saiu", "cancelado", "delivery")).toBe(true);
    expect(isForwardOrCancel("finalizado", "cancelado", "delivery")).toBe(false);
  });
});

describe("orderStatusMessageKind (FR-201, FR-202)", () => {
  test("each target status maps to its kind", () => {
    expect(orderStatusMessageKind("aguardando", "confirmado", "delivery")).toBe("order_confirmed");
    expect(orderStatusMessageKind("confirmado", "pronto", "pickup")).toBe("order_ready");
    expect(orderStatusMessageKind("pronto", "saiu", "delivery")).toBe("order_out_for_delivery");
    expect(orderStatusMessageKind("confirmado", "cancelado", "delivery")).toBe("order_cancelled");
  });
  test("finalizado sends no message (ADR-028)", () => {
    expect(orderStatusMessageKind("saiu", "finalizado", "delivery")).toBeNull();
    expect(orderStatusMessageKind("pronto", "finalizado", "pickup")).toBeNull();
    expect(orderStatusMessageKind("aguardando", "finalizado", "delivery")).toBeNull();
  });
  test("a forward skip gives only the target's kind", () => {
    expect(orderStatusMessageKind("aguardando", "saiu", "delivery")).toBe("order_out_for_delivery");
    expect(orderStatusMessageKind("aguardando", "pronto", "pickup")).toBe("order_ready");
  });
  test("a back step and a no-op give nothing", () => {
    expect(orderStatusMessageKind("pronto", "confirmado", "delivery")).toBeNull();
    expect(orderStatusMessageKind("pronto", "confirmado", "pickup")).toBeNull();
    expect(orderStatusMessageKind("pronto", "pronto", "pickup")).toBeNull();
  });
  test("order_ready is for pickup only; a delivery order at pronto gives nothing", () => {
    expect(orderStatusMessageKind("confirmado", "pronto", "pickup")).toBe("order_ready");
    expect(orderStatusMessageKind("confirmado", "pronto", "delivery")).toBeNull();
  });
});

describe("decideOrderStatusMessage (FR-201–FR-205, FR-117)", () => {
  test("inside the window: free text with the three variables", () => {
    expect(decideOrderStatusMessage({ ...base, from: "confirmado", to: "pronto", fulfillment: "pickup" })).toEqual({
      action: "send_text",
      kind: "order_ready",
      body: "Pedido ORD-042 pronto no Marmitop Centro.",
    });
    expect(decideOrderStatusMessage(base)).toEqual({
      action: "send_text",
      kind: "order_confirmed",
      body: "Olá Ana! Pedido ORD-042 confirmado.",
    });
  });
  test("outside the window with a template: the kind's template", () => {
    const d = decideOrderStatusMessage({
      ...base,
      to: "cancelado",
      lastInboundAt: hoursAgo(30),
      config: config({
        order_cancelled: on("Pedido {{pedido}} cancelado.", {
          templateName: "pedido_cancelado",
          templateLanguage: "pt_BR",
        }),
      }),
    });
    expect(d).toEqual({
      action: "send_template",
      kind: "order_cancelled",
      body: "Pedido ORD-042 cancelado.",
      templateName: "pedido_cancelado",
      templateLanguage: "pt_BR",
    });
  });
  test("outside the window without a template: failed with outside_service_window", () => {
    expect(decideOrderStatusMessage({ ...base, lastInboundAt: null })).toEqual({
      action: "fail",
      kind: "order_confirmed",
      body: "Olá Ana! Pedido ORD-042 confirmado.",
      errorCode: "outside_service_window",
    });
  });
  test("a disabled kind sends nothing", () => {
    expect(decideOrderStatusMessage({ ...base, config: config({ order_confirmed: off }) })).toEqual({
      action: "skip",
      reason: "disabled",
    });
  });
  test("a back step, a no-op, and a delivery order at pronto send nothing", () => {
    expect(decideOrderStatusMessage({ ...base, from: "pronto", to: "confirmado" })).toEqual({
      action: "skip",
      reason: "no_message",
    });
    expect(decideOrderStatusMessage({ ...base, from: "confirmado", to: "confirmado" })).toEqual({
      action: "skip",
      reason: "no_message",
    });
    expect(decideOrderStatusMessage({ ...base, from: "confirmado", to: "pronto" })).toEqual({
      action: "skip",
      reason: "no_message",
    });
  });
  test("a forward skip sends only the target's message", () => {
    expect(decideOrderStatusMessage({ ...base, from: "aguardando", to: "saiu" })).toMatchObject({
      action: "send_text",
      kind: "order_out_for_delivery",
    });
  });
  test("no conversation sends nothing (counter order)", () => {
    expect(decideOrderStatusMessage({ ...base, hasConversation: false })).toEqual({
      action: "skip",
      reason: "no_conversation",
    });
  });
  test("a kind already sent for this order sends nothing (FR-203)", () => {
    expect(decideOrderStatusMessage({ ...base, alreadySent: true })).toEqual({
      action: "skip",
      reason: "already_sent",
    });
  });
});
