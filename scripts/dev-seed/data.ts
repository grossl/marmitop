// scripts/dev-seed/data.ts
//
// Restaurant configuration for the seed: settings, business hours, and
// automatic messages. The seed holds no operational data (ADR-024): menu,
// stock, customers, conversations, orders, and invoices come only from use
// of the apps and from the sibling stacks.

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface BusinessDay {
  weekday: Weekday;
  enabled: boolean;
  opens: string;
  closes: string;
}

export interface RestaurantContent {
  settings: {
    autoAccept: boolean;
    allowPickup: boolean;
    showDeliveryEstimate: boolean;
    deliveryEstimateMinutes: number;
    deliveryFeeCents: number;
  };
  hours: BusinessDay[];
  automaticMessages: { kind: AutomaticMessageKind; enabled: boolean; body: string }[];
}

type AutomaticMessageKind =
  | "welcome"
  | "closed"
  | "order_received"
  | "order_confirmed"
  | "order_preparing"
  | "order_ready"
  | "order_out_for_delivery"
  | "order_delivered"
  | "order_cancelled";

/** The six order status messages with the ADR-026 defaults, as migration 0021 inserts them. */
export const ORDER_STATUS_MESSAGE_DEFAULTS: RestaurantContent["automaticMessages"] = [
  {
    kind: "order_confirmed",
    enabled: true,
    body: "Olá {{nome}}! Seu pedido {{pedido}} foi confirmado e logo entra em preparo.",
  },
  { kind: "order_preparing", enabled: false, body: "Seu pedido {{pedido}} está sendo preparado." },
  {
    kind: "order_ready",
    enabled: true,
    body: "Seu pedido {{pedido}} está pronto! Pode vir retirar no {{restaurante}}.",
  },
  { kind: "order_out_for_delivery", enabled: true, body: "Seu pedido {{pedido}} saiu para entrega!" },
  { kind: "order_delivered", enabled: false, body: "Pedido {{pedido}} entregue. Obrigado pela preferência, {{nome}}!" },
  {
    kind: "order_cancelled",
    enabled: true,
    body: "Seu pedido {{pedido}} foi cancelado. Se tiver dúvidas, responda esta mensagem.",
  },
];

export const CASA: RestaurantContent = {
  settings: {
    autoAccept: true,
    allowPickup: true,
    showDeliveryEstimate: true,
    deliveryEstimateMinutes: 45,
    deliveryFeeCents: 500,
  },
  hours: [
    { weekday: 1, enabled: true, opens: "08:00", closes: "18:00" },
    { weekday: 2, enabled: true, opens: "08:00", closes: "18:00" },
    { weekday: 3, enabled: true, opens: "08:00", closes: "18:00" },
    { weekday: 4, enabled: true, opens: "08:00", closes: "18:00" },
    { weekday: 5, enabled: true, opens: "08:00", closes: "18:00" },
    { weekday: 6, enabled: true, opens: "09:00", closes: "15:00" },
    { weekday: 0, enabled: false, opens: "09:00", closes: "14:00" },
  ],
  automaticMessages: [
    { kind: "welcome", enabled: true, body: "Olá! Bem-vindo à {{restaurante}}. Como podemos ajudar?" },
    {
      kind: "closed",
      enabled: true,
      body: "Olá! Estamos fora do nosso horário de atendimento. Retornaremos assim que abrirmos.",
    },
    { kind: "order_received", enabled: true, body: "Recebemos seu pedido! Em breve confirmaremos os detalhes." },
    ...ORDER_STATUS_MESSAGE_DEFAULTS,
  ],
};

export const MINAS: RestaurantContent = {
  settings: {
    autoAccept: false,
    allowPickup: true,
    showDeliveryEstimate: true,
    deliveryEstimateMinutes: 50,
    deliveryFeeCents: 700,
  },
  hours: [
    { weekday: 0, enabled: true, opens: "11:00", closes: "15:00" },
    { weekday: 1, enabled: false, opens: "11:00", closes: "15:00" },
    { weekday: 2, enabled: true, opens: "11:00", closes: "15:00" },
    { weekday: 3, enabled: true, opens: "11:00", closes: "15:00" },
    { weekday: 4, enabled: true, opens: "11:00", closes: "15:00" },
    { weekday: 5, enabled: true, opens: "11:00", closes: "22:00" },
    { weekday: 6, enabled: true, opens: "11:00", closes: "22:00" },
  ],
  automaticMessages: [
    { kind: "welcome", enabled: true, body: "Uai, {{nome}}! Bem-vindo ao {{restaurante}}. O que vai ser hoje?" },
    { kind: "closed", enabled: true, body: "Estamos fechados agora. Abrimos de terça a domingo, a partir das 11h." },
    { kind: "order_received", enabled: false, body: "Pedido {{pedido}} recebido! Já vamos preparar." },
    ...ORDER_STATUS_MESSAGE_DEFAULTS,
  ],
};
