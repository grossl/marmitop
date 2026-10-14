// scripts/dev-seed/data.ts
//
// Demo content for the seed. "Marmita da Casa" is the prototype's mock data,
// ported from apps/dashboard/lib/marmita-data.ts, components/stock-page.tsx
// and components/settings-page.tsx, with structured addresses (ADR-016),
// E.164 phones, and integer cents (ADR-006). "Sabor de Minas" is a small
// second tenant, so isolation is visible in the dashboard.

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Prototype weekday keys to `extract(dow)` values (0 = Sunday). */
const DOW = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 } as const;
type DayKey = keyof typeof DOW;
const days = (...keys: DayKey[]): Weekday[] => keys.map((k) => DOW[k]).sort((a, b) => a - b) as Weekday[];
const ALL_DAYS = days("dom", "seg", "ter", "qua", "qui", "sex", "sab");
const WEEKDAYS = days("seg", "ter", "qua", "qui", "sex");

export interface Address {
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
}

export interface CustomerSpec {
  key: string;
  name: string;
  phone: string;
  email: string | null;
  cpfCnpj: string | null;
  address: Address;
  /** "Cliente desde": days before the reset. */
  joinedDaysAgo: number;
  /** Weight in the historical order generator. */
  weight: number;
}

export interface SizeSpec {
  name: string;
  priceCents: number;
}

export interface MenuItemSpec {
  key: string;
  kind: "meal" | "drink";
  name: string;
  description: string;
  category: string;
  priceCents: number;
  available: boolean;
  popular: boolean;
  calories: number | null;
  volume: string | null;
  weekdays: Weekday[];
  sizes: SizeSpec[];
  /** Weight in the historical order generator (meals); from the prototype's top items. */
  weight: number;
}

export interface StockSpec {
  key: string;
  name: string;
  unit: string;
  category: "insumos" | "embalagens" | "bebidas";
  current: number;
  minimum: number;
  unitCostCents: number;
  /** Units consumed after the opening `in` movement; current = opening - used. */
  used: number;
}

export interface ChatLine {
  from: "client" | "restaurant";
  text: string;
  /** Wall-clock time on the prototype's day, HH:MM. */
  time: string;
  /** Prototype order id this message is tagged with. */
  orderId?: string;
}

export interface ConversationSpec {
  customerKey: string;
  unread: number;
  lines: ChatLine[];
}

export interface TodayOrderSpec {
  mockId: string;
  customerKey: string;
  status: "aguardando" | "confirmado" | "preparando" | "pronto" | "saiu" | "entregue";
  items: { menuKey: string; qty: number; size?: string; notes?: string }[];
  time: string;
  payment: "pix" | "dinheiro" | "cartao_credito" | "cartao_debito";
  notes?: string;
}

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
  automaticMessages: { kind: "welcome" | "closed" | "order_received"; enabled: boolean; body: string }[];
  customers: CustomerSpec[];
  menu: MenuItemSpec[];
  stock: StockSpec[];
  conversations: ConversationSpec[];
  todayOrders: TodayOrderSpec[];
  /** Orders per day for the 13 days before today (oldest first), from the prototype's dailyData. */
  dailyOrders: number[];
  /** Orders per 30-day block, newest block first, from the prototype's monthlyData. */
  monthlyOrders: number[];
  bairros: { bairro: string; cep: string; logradouro: string }[];
  syntheticCustomers: number;
}

const toCents = (reais: number) => Math.round(reais * 100);
const meal = (
  key: string,
  name: string,
  description: string,
  price: number,
  category: string,
  opts: {
    popular?: boolean;
    available?: boolean;
    calories: number;
    weekdays: Weekday[];
    sizes?: [string, number][];
    weight?: number;
  },
): MenuItemSpec => ({
  key,
  kind: "meal",
  name,
  description,
  category,
  priceCents: toCents(price),
  available: opts.available ?? true,
  popular: opts.popular ?? false,
  calories: opts.calories,
  volume: null,
  weekdays: opts.weekdays,
  sizes: (opts.sizes ?? []).map(([n, p]) => ({ name: n, priceCents: toCents(p) })),
  weight: opts.weight ?? 1,
});
const drink = (
  key: string,
  name: string,
  description: string,
  price: number,
  category: string,
  volume: string,
  opts: { popular?: boolean; available?: boolean; weekdays: Weekday[]; sizes?: [string, number][] },
): MenuItemSpec => ({
  key,
  kind: "drink",
  name,
  description,
  category,
  priceCents: toCents(price),
  available: opts.available ?? true,
  popular: opts.popular ?? false,
  calories: null,
  volume,
  weekdays: opts.weekdays,
  sizes: (opts.sizes ?? []).map(([n, p]) => ({ name: n, priceCents: toCents(p) })),
  weight: 1,
});

/** "(11) 98765-4321" -> "+5511987654321" (FR-047). */
export function e164(display: string): string {
  return `+55${display.replace(/\D/g, "")}`;
}

/** The prototype's join dates are relative to its own "today", 2025-05-07. */
function joinedDaysAgo(isoDate: string): number {
  const prototypeToday = Date.UTC(2025, 4, 7);
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return Math.round((prototypeToday - Date.UTC(y, m - 1, d)) / 86_400_000);
}

const settingsPageDefaults = {
  hours: [
    { weekday: 1, enabled: true, opens: "08:00", closes: "18:00" },
    { weekday: 2, enabled: true, opens: "08:00", closes: "18:00" },
    { weekday: 3, enabled: true, opens: "08:00", closes: "18:00" },
    { weekday: 4, enabled: true, opens: "08:00", closes: "18:00" },
    { weekday: 5, enabled: true, opens: "08:00", closes: "18:00" },
    { weekday: 6, enabled: true, opens: "09:00", closes: "15:00" },
    { weekday: 0, enabled: false, opens: "09:00", closes: "14:00" },
  ] as BusinessDay[],
  automaticMessages: [
    { kind: "welcome", enabled: true, body: "Olá! Bem-vindo à {{restaurante}}. Como podemos ajudar?" },
    {
      kind: "closed",
      enabled: true,
      body: "Olá! Estamos fora do nosso horário de atendimento. Retornaremos assim que abrirmos.",
    },
    { kind: "order_received", enabled: true, body: "Recebemos seu pedido! Em breve confirmaremos os detalhes." },
  ] as RestaurantContent["automaticMessages"],
};

// ---------------------------------------------------------------------------
// Marmita da Casa (the prototype)
// ---------------------------------------------------------------------------

export const CASA: RestaurantContent = {
  settings: {
    autoAccept: true,
    allowPickup: true,
    showDeliveryEstimate: true,
    deliveryEstimateMinutes: 45,
    deliveryFeeCents: 500,
  },
  hours: settingsPageDefaults.hours,
  automaticMessages: settingsPageDefaults.automaticMessages,
  customers: [
    {
      key: "maria",
      name: "Maria Fernanda",
      phone: e164("(11) 98765-4321"),
      email: "maria.fernanda@email.com",
      cpfCnpj: "52998224725",
      address: {
        cep: "05433000",
        logradouro: "Rua das Flores",
        numero: "342",
        complemento: "apto 52",
        bairro: "Vila Madalena",
      },
      joinedDaysAgo: joinedDaysAgo("2024-03-15"),
      weight: 4,
    },
    {
      key: "joao",
      name: "João Carlos",
      phone: e164("(11) 91234-5678"),
      email: "joao.carlos@email.com",
      cpfCnpj: null,
      address: {
        cep: "01310100",
        logradouro: "Av. Paulista",
        numero: "900",
        complemento: "sala 12",
        bairro: "Bela Vista",
      },
      joinedDaysAgo: joinedDaysAgo("2024-01-08"),
      weight: 5,
    },
    {
      key: "ana",
      name: "Ana Paula",
      phone: e164("(11) 99876-5432"),
      email: "ana.paula@email.com",
      cpfCnpj: null,
      address: {
        cep: "01305000",
        logradouro: "Rua Augusta",
        numero: "200",
        complemento: "apto 10",
        bairro: "Consolação",
      },
      joinedDaysAgo: joinedDaysAgo("2024-05-20"),
      weight: 2,
    },
    {
      key: "roberto",
      name: "Roberto Lima",
      phone: e164("(11) 97654-3210"),
      email: "roberto.lima@email.com",
      cpfCnpj: null,
      address: {
        cep: "05406000",
        logradouro: "Rua Teodoro Sampaio",
        numero: "880",
        complemento: null,
        bairro: "Pinheiros",
      },
      joinedDaysAgo: joinedDaysAgo("2024-07-12"),
      weight: 1,
    },
    {
      key: "claudia",
      name: "Claudia Souza",
      phone: e164("(11) 96543-2109"),
      email: "claudia.souza@email.com",
      cpfCnpj: "11444777000161",
      address: { cep: "01426000", logradouro: "Rua Oscar Freire", numero: "55", complemento: null, bairro: "Jardins" },
      joinedDaysAgo: joinedDaysAgo("2024-02-01"),
      weight: 4,
    },
    {
      key: "pedro",
      name: "Pedro Alves",
      phone: e164("(11) 95432-1098"),
      email: "pedro.alves@email.com",
      cpfCnpj: null,
      address: {
        cep: "01418100",
        logradouro: "Alameda Santos",
        numero: "1200",
        complemento: null,
        bairro: "Cerqueira César",
      },
      joinedDaysAgo: joinedDaysAgo("2024-04-18"),
      weight: 2,
    },
    {
      key: "fernanda",
      name: "Fernanda Costa",
      phone: e164("(11) 94321-0987"),
      email: "fernanda.costa@email.com",
      cpfCnpj: null,
      address: { cep: "04028000", logradouro: "Av. Ibirapuera", numero: "3100", complemento: null, bairro: "Moema" },
      joinedDaysAgo: joinedDaysAgo("2024-06-05"),
      weight: 3,
    },
    {
      key: "lucas",
      name: "Lucas Mendes",
      phone: e164("(11) 93210-9876"),
      email: "lucas.mendes@email.com",
      cpfCnpj: null,
      address: {
        cep: "04534003",
        logradouro: "Rua Joaquim Floriano",
        numero: "820",
        complemento: null,
        bairro: "Itaim Bibi",
      },
      joinedDaysAgo: joinedDaysAgo("2024-08-22"),
      weight: 2,
    },
  ],
  menu: [
    meal(
      "MI-001",
      "Frango Grelhado",
      "Frango grelhado temperado na hora, acompanhado de arroz branco, feijão carioca, farofa e salada mista.",
      18.9,
      "proteinas",
      {
        popular: true,
        calories: 520,
        weekdays: WEEKDAYS,
        sizes: [
          ["P", 14.9],
          ["M", 18.9],
          ["G", 23.9],
        ],
        weight: 312,
      },
    ),
    meal(
      "MI-002",
      "Picanha com Arroz e Batata Frita",
      "Fatias de picanha grelhada ao ponto, arroz branco, batata frita crocante e vinagrete.",
      29.9,
      "proteinas",
      {
        popular: true,
        calories: 780,
        weekdays: days("sex", "sab", "dom"),
        sizes: [
          ["M", 25.9],
          ["G", 29.9],
          ["Família", 54.9],
        ],
        weight: 143,
      },
    ),
    meal(
      "MI-003",
      "Bife Acebolado",
      "Bife de contra-filé com cebolas caramelizadas, arroz, feijão e purê de mandioca.",
      21.0,
      "proteinas",
      {
        calories: 610,
        weekdays: days("seg", "qua", "sex"),
        weight: 60,
      },
    ),
    meal(
      "MI-004",
      "Frango à Parmegiana",
      "Filé de frango empanado coberto com molho de tomate caseiro e queijo muçarela gratinado.",
      23.9,
      "proteinas",
      {
        popular: true,
        calories: 690,
        weekdays: days("ter", "qui", "sab"),
        weight: 131,
      },
    ),
    meal(
      "MI-005",
      "Strogonoff de Frango",
      "Strogonoff cremoso de frango com creme de leite, arroz branco e batata palha.",
      19.9,
      "proteinas",
      {
        calories: 600,
        weekdays: WEEKDAYS,
        weight: 87,
      },
    ),
    meal(
      "MI-006",
      "Feijoada Completa",
      "Feijoada tradicional com costelinha, linguiça, toucinho e couve refogada. Acompanha arroz, farofa e laranja.",
      25.0,
      "especial",
      {
        popular: true,
        calories: 850,
        weekdays: days("sab"),
        weight: 218,
      },
    ),
    meal(
      "MI-007",
      "Lasanha de Berinjela",
      "Lasanha vegetariana com berinjela grelhada, ricota temperada, molho de tomate fresco e queijo.",
      22.5,
      "vegetariano",
      {
        calories: 460,
        weekdays: days("ter", "qui"),
        weight: 98,
      },
    ),
    meal(
      "MI-008",
      "Marmita Vegetariana",
      "Legumes grelhados variados, grão-de-bico ao molho, arroz integral e salada de folhas.",
      22.5,
      "vegetariano",
      {
        calories: 390,
        weekdays: WEEKDAYS,
        weight: 40,
      },
    ),
    meal(
      "MI-009",
      "Marmita Fit",
      "Frango grelhado sem tempero industrializado, arroz integral, brócolis no vapor e cenoura.",
      26.0,
      "fit",
      {
        popular: true,
        calories: 420,
        weekdays: WEEKDAYS,
        weight: 74,
      },
    ),
    meal(
      "MI-010",
      "Bowl Proteico",
      "Base de quinoa, frango desfiado temperado, grão-de-bico, cenoura ralada e molho de iogurte.",
      28.5,
      "fit",
      {
        calories: 480,
        weekdays: days("seg", "qua", "sex"),
        weight: 30,
      },
    ),
    meal(
      "MI-011",
      "Marmita Executiva",
      "Prato do dia com opções rotativas de carne, frango ou peixe, dois acompanhamentos e sobremesa.",
      24.5,
      "executiva",
      {
        popular: true,
        calories: 650,
        weekdays: WEEKDAYS,
        weight: 195,
      },
    ),
    meal(
      "MI-012",
      "Executiva Premium",
      "Carne nobre do dia (alcatra, fraldinha ou filé), três acompanhamentos à escolha e suco incluído.",
      34.9,
      "executiva",
      {
        available: false,
        calories: 720,
        weekdays: days("sex", "sab"),
        weight: 0,
      },
    ),
    drink("DR-001", "Coca-Cola Lata 350ml", "Refrigerante gelado.", 5.0, "refrigerantes", "350ml", {
      popular: true,
      weekdays: ALL_DAYS,
    }),
    drink("DR-002", "Guaraná Antarctica 350ml", "Refrigerante de guaraná gelado.", 5.0, "refrigerantes", "350ml", {
      weekdays: ALL_DAYS,
    }),
    drink("DR-003", "Suco de Laranja Natural", "Suco espremido na hora, sem adição de açúcar.", 8.0, "sucos", "300ml", {
      popular: true,
      weekdays: WEEKDAYS,
      sizes: [
        ["300ml", 8.0],
        ["500ml", 12.0],
      ],
    }),
    drink("DR-004", "Suco de Maracujá Natural 300ml", "Suco de maracujá com água de coco.", 8.5, "sucos", "300ml", {
      weekdays: WEEKDAYS,
    }),
    drink(
      "DR-005",
      "Suco de Abacaxi com Hortelã 300ml",
      "Combinação refrescante de abacaxi e hortelã fresca.",
      9.0,
      "sucos",
      "300ml",
      {
        popular: true,
        weekdays: days("seg", "ter", "qua", "qui", "sex", "sab"),
      },
    ),
    drink("DR-006", "Água sem Gás 500ml", "Água mineral natural.", 3.0, "agua", "500ml", { weekdays: ALL_DAYS }),
    drink("DR-007", "Água com Gás 500ml", "Água mineral gaseificada.", 4.0, "agua", "500ml", { weekdays: ALL_DAYS }),
    drink(
      "DR-008",
      "Cerveja Heineken Long Neck 330ml",
      "Cerveja premium importada gelada.",
      10.0,
      "alcoolicas",
      "330ml",
      {
        popular: true,
        weekdays: days("sex", "sab", "dom"),
      },
    ),
    drink(
      "DR-009",
      "Caipirinha de Limão",
      "Caipirinha artesanal com limão taiti, cachaça e açúcar.",
      14.0,
      "alcoolicas",
      "300ml",
      {
        weekdays: days("sab", "dom"),
      },
    ),
    drink("DR-010", "Café Expresso", "Café expresso forte e encorpado.", 5.0, "quentes", "50ml", {
      weekdays: WEEKDAYS,
    }),
    drink("DR-011", "Café com Leite", "Café coado com leite quente cremoso.", 7.0, "quentes", "200ml", {
      popular: true,
      weekdays: WEEKDAYS,
      sizes: [
        ["P", 7.0],
        ["G", 9.5],
      ],
    }),
    drink("DR-012", "Chá Gelado de Pêssego", "Chá gelado artesanal de pêssego com hortelã.", 7.5, "quentes", "300ml", {
      available: false,
      weekdays: days("seg", "ter", "qua", "qui", "sex", "sab"),
    }),
  ],
  stock: [
    {
      key: "st-1",
      name: "Arroz branco",
      unit: "kg",
      category: "insumos",
      current: 18,
      minimum: 10,
      unitCostCents: 650,
      used: 12,
    },
    {
      key: "st-2",
      name: "Feijão carioca",
      unit: "kg",
      category: "insumos",
      current: 7,
      minimum: 8,
      unitCostCents: 890,
      used: 9,
    },
    {
      key: "st-3",
      name: "Frango",
      unit: "kg",
      category: "insumos",
      current: 24,
      minimum: 12,
      unitCostCents: 1490,
      used: 16,
    },
    {
      key: "st-4",
      name: "Carne bovina",
      unit: "kg",
      category: "insumos",
      current: 5,
      minimum: 8,
      unitCostCents: 3150,
      used: 7,
    },
    {
      key: "st-5",
      name: "Marmita 500ml",
      unit: "un",
      category: "embalagens",
      current: 96,
      minimum: 40,
      unitCostCents: 85,
      used: 104,
    },
    {
      key: "st-6",
      name: "Tampa 500ml",
      unit: "un",
      category: "embalagens",
      current: 28,
      minimum: 40,
      unitCostCents: 35,
      used: 172,
    },
    {
      key: "st-7",
      name: "Água 500ml",
      unit: "un",
      category: "bebidas",
      current: 42,
      minimum: 20,
      unitCostCents: 210,
      used: 18,
    },
    {
      key: "st-8",
      name: "Coca-Cola lata",
      unit: "un",
      category: "bebidas",
      current: 12,
      minimum: 24,
      unitCostCents: 320,
      used: 36,
    },
  ],
  conversations: [
    {
      customerKey: "maria",
      unread: 3,
      lines: [
        { from: "client", text: "Oi! Bom dia! Vi que vocês tem marmitas de frango hoje", time: "12:28" },
        {
          from: "restaurant",
          text: "Bom dia, Maria! Sim, temos frango grelhado, frango ensopado e frango à milanesa",
          time: "12:29",
        },
        {
          from: "client",
          text: "Que delícia! Quero pedir 2 marmitas de frango grelhado com arroz, feijão, farofa e salada",
          time: "12:31",
        },
        { from: "restaurant", text: "Perfeito! Vou registrar seu pedido. Endereço de entrega?", time: "12:32" },
        { from: "client", text: "Rua das Flores, 342, apto 52 - Vila Madalena", time: "12:33" },
        { from: "client", text: "Quero pedir 2 marmitas de frango grelhado", time: "12:34", orderId: "ORD-001" },
      ],
    },
    {
      customerKey: "joao",
      unread: 1,
      lines: [
        { from: "client", text: "Olá! Fiz um pedido de picanha com arroz e batata frita", time: "12:15" },
        { from: "restaurant", text: "Oi João! Seu pedido foi confirmado e já está sendo preparado", time: "12:16" },
        { from: "client", text: "Quanto tempo demora a entrega?", time: "12:20", orderId: "ORD-002" },
      ],
    },
    {
      customerKey: "ana",
      unread: 0,
      lines: [
        { from: "client", text: "Quero 1 marmita vegetariana por favor", time: "11:50", orderId: "ORD-003" },
        {
          from: "restaurant",
          text: "Claro Ana! Temos legumes grelhados com quinoa, quibe de couve-flor e lasanha de berinjela",
          time: "11:52",
        },
        { from: "client", text: "Vou querer a lasanha de berinjela!", time: "11:54" },
        { from: "restaurant", text: "Anotado! Seu pedido sai em breve", time: "11:56" },
        { from: "client", text: "Perfeito! Muito obrigada", time: "11:58" },
      ],
    },
    { customerKey: "roberto", unread: 0, lines: [{ from: "client", text: "Tem marmita fit hoje?", time: "11:45" }] },
    {
      customerKey: "claudia",
      unread: 0,
      lines: [
        { from: "client", text: "Bom dia! Quero 3 marmitas de feijoada", time: "11:10", orderId: "ORD-004" },
        { from: "restaurant", text: "Bom dia Claudia! Anotado, 3 feijoadas", time: "11:12" },
        { from: "client", text: "Pode incluir sem cebola por favor", time: "11:20" },
      ],
    },
    {
      customerKey: "pedro",
      unread: 0,
      lines: [
        { from: "client", text: "Quero 1 marmita de bife acebolado", time: "10:30", orderId: "ORD-005" },
        { from: "restaurant", text: "Pedido confirmado Pedro!", time: "10:32" },
        { from: "client", text: "Marmita chegou, estava ótima!", time: "10:55" },
        { from: "restaurant", text: "Fico muito feliz! Obrigado Pedro", time: "10:56" },
      ],
    },
    {
      customerKey: "fernanda",
      unread: 2,
      lines: [
        {
          from: "client",
          text: "Boa tarde! Quero confirmar o pedido de 2 marmitas executivas",
          time: "13:58",
          orderId: "ORD-006",
        },
        { from: "restaurant", text: "Confirmado Fernanda! 2 marmitas executivas a caminho.", time: "14:00" },
        { from: "client", text: "Boa tarde! Quero confirmar o pedido", time: "14:02" },
      ],
    },
    {
      customerKey: "lucas",
      unread: 0,
      lines: [
        {
          from: "client",
          text: "Olá, tudo bem? Quero 1 marmita de frango à parmegiana",
          time: "13:35",
          orderId: "ORD-007",
        },
        { from: "restaurant", text: "Oi Lucas! Pedido recebido, vai sair em uns 40 min", time: "13:37" },
        { from: "client", text: "Pode adicionar mais arroz?", time: "13:40" },
      ],
    },
  ],
  todayOrders: [
    {
      mockId: "ORD-001",
      customerKey: "maria",
      status: "preparando",
      items: [{ menuKey: "MI-001", qty: 2, size: "M", notes: "Arroz, feijão, farofa e salada" }],
      time: "12:34",
      payment: "pix",
    },
    {
      mockId: "ORD-002",
      customerKey: "joao",
      status: "confirmado",
      items: [{ menuKey: "MI-002", qty: 1, size: "G" }],
      time: "12:20",
      payment: "cartao_credito",
    },
    {
      mockId: "ORD-003",
      customerKey: "ana",
      status: "pronto",
      items: [{ menuKey: "MI-007", qty: 1 }],
      time: "11:54",
      payment: "pix",
    },
    {
      mockId: "ORD-004",
      customerKey: "claudia",
      status: "aguardando",
      items: [{ menuKey: "MI-006", qty: 3, notes: "Sem cebola" }],
      time: "11:20",
      payment: "dinheiro",
    },
    {
      mockId: "ORD-005",
      customerKey: "pedro",
      status: "saiu",
      items: [{ menuKey: "MI-003", qty: 1 }],
      time: "10:30",
      payment: "pix",
    },
    {
      mockId: "ORD-006",
      customerKey: "fernanda",
      status: "aguardando",
      items: [{ menuKey: "MI-011", qty: 2 }],
      time: "14:02",
      payment: "cartao_debito",
    },
    {
      mockId: "ORD-007",
      customerKey: "lucas",
      status: "preparando",
      items: [{ menuKey: "MI-004", qty: 1, notes: "Arroz extra" }],
      time: "13:37",
      payment: "pix",
    },
    {
      mockId: "ORD-008",
      customerKey: "maria",
      status: "saiu",
      items: [{ menuKey: "MI-001", qty: 1, size: "P" }],
      time: "12:00",
      payment: "pix",
    },
    {
      mockId: "ORD-009",
      customerKey: "joao",
      status: "pronto",
      items: [{ menuKey: "MI-005", qty: 2 }],
      time: "11:30",
      payment: "cartao_credito",
    },
    {
      mockId: "ORD-010",
      customerKey: "claudia",
      status: "confirmado",
      items: [{ menuKey: "MI-006", qty: 2 }],
      time: "11:00",
      payment: "dinheiro",
    },
    {
      mockId: "ORD-011",
      customerKey: "ana",
      status: "aguardando",
      items: [{ menuKey: "MI-008", qty: 1 }],
      time: "10:20",
      payment: "pix",
    },
    {
      mockId: "ORD-012",
      customerKey: "fernanda",
      status: "saiu",
      items: [{ menuKey: "MI-011", qty: 3 }],
      time: "13:15",
      payment: "cartao_credito",
    },
    {
      mockId: "ORD-013",
      customerKey: "pedro",
      status: "confirmado",
      items: [{ menuKey: "MI-003", qty: 2 }],
      time: "12:40",
      payment: "pix",
    },
    {
      mockId: "ORD-014",
      customerKey: "roberto",
      status: "pronto",
      items: [{ menuKey: "MI-009", qty: 2 }],
      time: "12:15",
      payment: "cartao_debito",
    },
    {
      mockId: "ORD-015",
      customerKey: "lucas",
      status: "preparando",
      items: [{ menuKey: "MI-004", qty: 1 }],
      time: "11:50",
      payment: "pix",
    },
    // Delivered earlier today, so the board's daily KPIs are not empty.
    {
      mockId: "T-016",
      customerKey: "joao",
      status: "entregue",
      items: [
        { menuKey: "MI-011", qty: 1 },
        { menuKey: "DR-001", qty: 1 },
      ],
      time: "09:40",
      payment: "pix",
    },
    {
      mockId: "T-017",
      customerKey: "maria",
      status: "entregue",
      items: [{ menuKey: "MI-009", qty: 1 }],
      time: "09:55",
      payment: "cartao_credito",
    },
    {
      mockId: "T-018",
      customerKey: "claudia",
      status: "entregue",
      items: [{ menuKey: "MI-001", qty: 2, size: "G" }],
      time: "10:05",
      payment: "pix",
    },
  ],
  dailyOrders: [11, 14, 9, 17, 13, 18, 12, 15, 19, 16, 21, 14, 18],
  monthlyOrders: [193, 164, 178, 158, 131, 148],
  bairros: [
    { bairro: "Vila Madalena", cep: "05435001", logradouro: "Rua Harmonia" },
    { bairro: "Pinheiros", cep: "05422001", logradouro: "Rua dos Pinheiros" },
    { bairro: "Perdizes", cep: "05015000", logradouro: "Rua Cardoso de Almeida" },
    { bairro: "Bela Vista", cep: "01318000", logradouro: "Rua Treze de Maio" },
    { bairro: "Consolação", cep: "01302001", logradouro: "Rua da Consolação" },
    { bairro: "Moema", cep: "04077000", logradouro: "Alameda dos Maracatins" },
    { bairro: "Itaim Bibi", cep: "04530001", logradouro: "Rua Tabapuã" },
    { bairro: "Sumaré", cep: "01252000", logradouro: "Av. Sumaré" },
  ],
  syntheticCustomers: 32,
};

// ---------------------------------------------------------------------------
// Sabor de Minas (second tenant)
// ---------------------------------------------------------------------------

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
  ],
  customers: [
    {
      key: "beatriz",
      name: "Beatriz Andrade",
      phone: e164("(31) 99123-4567"),
      email: "beatriz.andrade@email.com",
      cpfCnpj: null,
      address: {
        cep: "30130010",
        logradouro: "Av. Afonso Pena",
        numero: "1500",
        complemento: "apto 801",
        bairro: "Centro",
      },
      joinedDaysAgo: 120,
      weight: 3,
    },
    {
      key: "otavio",
      name: "Otávio Ramos",
      phone: e164("(31) 98765-1234"),
      email: null,
      cpfCnpj: null,
      address: {
        cep: "30140071",
        logradouro: "Rua Pernambuco",
        numero: "350",
        complemento: null,
        bairro: "Funcionários",
      },
      joinedDaysAgo: 60,
      weight: 2,
    },
    {
      key: "luiza",
      name: "Luiza Teixeira",
      phone: e164("(31) 97654-9876"),
      email: "luiza.t@email.com",
      cpfCnpj: null,
      address: { cep: "30380000", logradouro: "Rua Tomé de Souza", numero: "88", complemento: null, bairro: "Savassi" },
      joinedDaysAgo: 30,
      weight: 1,
    },
  ],
  menu: [
    meal("MG-001", "Feijão Tropeiro", "Feijão tropeiro com linguiça, torresmo, couve e ovo.", 27.0, "especial", {
      popular: true,
      calories: 820,
      weekdays: days("dom", "ter", "qua", "qui", "sex", "sab"),
      sizes: [
        ["Individual", 27.0],
        ["Família", 69.0],
      ],
      weight: 5,
    }),
    meal("MG-002", "Frango com Quiabo", "Frango caipira ensopado com quiabo, angu e arroz.", 25.0, "proteinas", {
      calories: 640,
      weekdays: days("dom", "qua", "sab"),
      weight: 3,
    }),
    meal("MG-003", "Tutu à Mineira", "Tutu de feijão, lombo, couve, linguiça e ovo cozido.", 26.0, "especial", {
      calories: 760,
      weekdays: days("ter", "qui", "sex"),
      weight: 3,
    }),
    meal("MG-004", "Vaca Atolada", "Costela cozida com mandioca, arroz branco e couve.", 32.0, "proteinas", {
      popular: true,
      calories: 880,
      weekdays: days("sex", "sab", "dom"),
      weight: 2,
    }),
    drink("MG-D01", "Cajuína 300ml", "Bebida de caju clarificada, gelada.", 7.0, "sucos", "300ml", {
      weekdays: ALL_DAYS,
    }),
  ],
  stock: [
    {
      key: "mg-st-1",
      name: "Feijão",
      unit: "kg",
      category: "insumos",
      current: 15,
      minimum: 10,
      unitCostCents: 920,
      used: 5,
    },
    {
      key: "mg-st-2",
      name: "Linguiça",
      unit: "kg",
      category: "insumos",
      current: 4,
      minimum: 6,
      unitCostCents: 2490,
      used: 8,
    },
  ],
  conversations: [
    {
      customerKey: "beatriz",
      unread: 1,
      lines: [
        { from: "client", text: "Boa tarde! Tem tropeiro hoje?", time: "13:10" },
        { from: "restaurant", text: "Tem sim, Beatriz! Individual ou família?", time: "13:12" },
        { from: "client", text: "Família, por favor", time: "13:15", orderId: "MG-T1" },
      ],
    },
  ],
  todayOrders: [
    {
      mockId: "MG-T1",
      customerKey: "beatriz",
      status: "aguardando",
      items: [{ menuKey: "MG-001", qty: 1, size: "Família" }],
      time: "13:15",
      payment: "pix",
    },
    {
      mockId: "MG-T2",
      customerKey: "otavio",
      status: "preparando",
      items: [
        { menuKey: "MG-004", qty: 1 },
        { menuKey: "MG-D01", qty: 2 },
      ],
      time: "12:40",
      payment: "dinheiro",
    },
  ],
  dailyOrders: [2, 3, 1, 0, 2, 4, 3, 2, 1, 3, 2, 0, 2],
  monthlyOrders: [40, 25, 0, 0, 0, 0],
  bairros: [
    { bairro: "Lourdes", cep: "30170000", logradouro: "Rua Curitiba" },
    { bairro: "Santa Efigênia", cep: "30260070", logradouro: "Av. Brasil" },
  ],
  syntheticCustomers: 4,
};

export const SYNTHETIC_FIRST_NAMES = [
  "Rafael",
  "Juliana",
  "Bruno",
  "Camila",
  "Thiago",
  "Larissa",
  "Gustavo",
  "Patrícia",
  "Eduardo",
  "Renata",
  "Felipe",
  "Aline",
  "Rodrigo",
  "Vanessa",
  "Marcelo",
  "Bianca",
  "André",
  "Tatiane",
  "Vinícius",
  "Gabriela",
];
export const SYNTHETIC_LAST_NAMES = [
  "Oliveira",
  "Santos",
  "Pereira",
  "Ferreira",
  "Rodrigues",
  "Almeida",
  "Nascimento",
  "Carvalho",
  "Gomes",
  "Martins",
  "Araújo",
  "Ribeiro",
  "Barbosa",
  "Cardoso",
  "Moreira",
];
