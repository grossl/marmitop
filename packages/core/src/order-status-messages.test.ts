// covers FR-200, FR-201, FR-202, FR-203, FR-204, FR-205, FR-115, FR-117, ADR-026
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
  order_preparing: on("Pedido {{pedido}} em preparo."),
  order_ready: on("Pedido {{pedido}} pronto no {{restaurante}}."),
  order_out_for_delivery: on("Pedido {{pedido}} saiu."),
  order_delivered: on("Pedido {{pedido}} entregue."),
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
  test("six kinds, one per target status", () => {
    expect(ORDER_STATUS_MESSAGE_KINDS).toEqual([
      "order_confirmed",
      "order_preparing",
      "order_ready",
      "order_out_for_delivery",
      "order_delivered",
      "order_cancelled",
    ]);
  });
});

describe("isForwardOrCancel (ADR-017, ADR-026)", () => {
  test("forward moves and skips are forward; a back step and a no-op are not", () => {
    expect(isForwardOrCancel("aguardando", "confirmado", "delivery")).toBe(true);
    expect(isForwardOrCancel("aguardando", "saiu", "delivery")).toBe(true);
    expect(isForwardOrCancel("pronto", "entregue", "pickup")).toBe(true);
    expect(isForwardOrCancel("preparando", "confirmado", "delivery")).toBe(false);
    expect(isForwardOrCancel("pronto", "pronto", "pickup")).toBe(false);
  });
  test("cancel from a non-final status is a forward move; from a final status it is not", () => {
    expect(isForwardOrCancel("saiu", "cancelado", "delivery")).toBe(true);
    expect(isForwardOrCancel("entregue", "cancelado", "delivery")).toBe(false);
  });
});

describe("orderStatusMessageKind (FR-201, FR-202)", () => {
  test("each target status maps to its kind", () => {
    expect(orderStatusMessageKind("aguardando", "confirmado", "delivery")).toBe("order_confirmed");
    expect(orderStatusMessageKind("confirmado", "preparando", "delivery")).toBe("order_preparing");
    expect(orderStatusMessageKind("preparando", "pronto", "pickup")).toBe("order_ready");
    expect(orderStatusMessageKind("pronto", "saiu", "delivery")).toBe("order_out_for_delivery");
    expect(orderStatusMessageKind("saiu", "entregue", "delivery")).toBe("order_delivered");
    expect(orderStatusMessageKind("preparando", "cancelado", "delivery")).toBe("order_cancelled");
  });
  test("a forward skip gives only the target's kind", () => {
    expect(orderStatusMessageKind("aguardando", "preparando", "delivery")).toBe("order_preparing");
    expect(orderStatusMessageKind("confirmado", "entregue", "pickup")).toBe("order_delivered");
  });
  test("a back step and a no-op give nothing", () => {
    expect(orderStatusMessageKind("preparando", "confirmado", "delivery")).toBeNull();
    expect(orderStatusMessageKind("pronto", "preparando", "pickup")).toBeNull();
    expect(orderStatusMessageKind("pronto", "pronto", "pickup")).toBeNull();
  });
  test("order_ready is for pickup only; a delivery order at pronto gives nothing", () => {
    expect(orderStatusMessageKind("preparando", "pronto", "pickup")).toBe("order_ready");
    expect(orderStatusMessageKind("preparando", "pronto", "delivery")).toBeNull();
  });
});

describe("decideOrderStatusMessage (FR-201–FR-205, FR-117)", () => {
  test("inside the window: free text with the three variables", () => {
    expect(decideOrderStatusMessage({ ...base, from: "preparando", to: "pronto", fulfillment: "pickup" })).toEqual({
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
    expect(decideOrderStatusMessage({ ...base, from: "preparando", to: "confirmado" })).toEqual({
      action: "skip",
      reason: "no_message",
    });
    expect(decideOrderStatusMessage({ ...base, from: "confirmado", to: "confirmado" })).toEqual({
      action: "skip",
      reason: "no_message",
    });
    expect(decideOrderStatusMessage({ ...base, from: "preparando", to: "pronto" })).toEqual({
      action: "skip",
      reason: "no_message",
    });
  });
  test("a forward skip sends only the target's message", () => {
    expect(decideOrderStatusMessage({ ...base, from: "aguardando", to: "preparando" })).toMatchObject({
      action: "send_text",
      kind: "order_preparing",
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
