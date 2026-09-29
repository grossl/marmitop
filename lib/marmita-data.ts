// ─── Types ────────────────────────────────────────────────────────────────────

export type OrderStatus = "aguardando" | "confirmado" | "preparando" | "pronto" | "saiu" | "entregue";
export type PaymentMethod = "pix" | "dinheiro" | "cartao_credito" | "cartao_debito";
export type Section = "mensagens" | "pedidos" | "contatos" | "relatorios" | "cardapio" | "estoque" | "novo-pedido";

export interface StockItem {
  id: string;
  name: string;
  unit: string;
  current: number;
  minimum: number;
  cost: number;
  category: "insumos" | "embalagens" | "bebidas";
}
export type MenuCategory = "proteinas" | "vegetariano" | "fit" | "executiva" | "especial";
export type DrinkCategory = "refrigerantes" | "sucos" | "agua" | "alcoolicas" | "quentes";
export type Weekday = "seg" | "ter" | "qua" | "qui" | "sex" | "sab" | "dom";

export interface SubItem {
  id: string;
  name: string;
  price: number;
  required: boolean;
}

export interface SizeOption {
  id: string;
  name: string; // ex: "P", "M", "G", "Individual", "Família"
  price: number;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;           // preço base (quando não há tamanhos)
  category: MenuCategory;
  available: boolean;
  popular: boolean;
  calories?: number;
  image?: string;
  sizes?: SizeOption[];    // tamanhos e preços por tamanho
  availableDays?: Weekday[];
}

export interface DrinkItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: DrinkCategory;
  available: boolean;
  popular: boolean;
  volume?: string;
  availableDays?: Weekday[];
}

export interface OrderItem {
  name: string;
  qty: number;
  price: number;
  size?: string;
  obs?: string;
}

export interface Order {
  id: string;
  contactId: string;
  status: OrderStatus;
  items: OrderItem[];
  total: number;
  address: string;
  neighborhood: string;
  createdAt: string;        // HH:mm (para o chat)
  date: string;             // ISO YYYY-MM-DD
  deliveryTime?: string;
  payment: PaymentMethod;
  note?: string;
}

export interface Message {
  id: string;
  from: "client" | "restaurant";
  text: string;
  time: string;
  orderId?: string;
}

export interface Contact {
  id: string;
  name: string;
  phone: string;
  email: string;
  avatar: string;
  neighborhood: string;
  address: string;
  lastMessage: string;
  lastTime: string;
  unread: number;
  online: boolean;
  joinDate: string;         // ISO YYYY-MM-DD
  totalOrders: number;
  totalSpent: number;
}

export interface MonthlyData {
  month: string;
  revenue: number;
  orders: number;
  avgTicket: number;
}

export interface DailyData {
  day: string;
  orders: number;
}

export interface TopItem {
  name: string;
  qty: number;
  revenue: number;
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

export const contacts: Contact[] = [
  {
    id: "1",
    name: "Maria Fernanda",
    phone: "(11) 98765-4321",
    email: "maria.fernanda@email.com",
    avatar: "MF",
    neighborhood: "Vila Madalena",
    address: "Rua das Flores, 342, apto 52",
    lastMessage: "Quero pedir 2 marmitas de frango grelhado",
    lastTime: "12:34",
    unread: 3,
    online: true,
    joinDate: "2024-03-15",
    totalOrders: 18,
    totalSpent: 428.6,
  },
  {
    id: "2",
    name: "João Carlos",
    phone: "(11) 91234-5678",
    email: "joao.carlos@email.com",
    avatar: "JC",
    neighborhood: "Bela Vista",
    address: "Av. Paulista, 900, sala 12",
    lastMessage: "Quanto tempo demora a entrega?",
    lastTime: "12:20",
    unread: 1,
    online: true,
    joinDate: "2024-01-08",
    totalOrders: 32,
    totalSpent: 812.3,
  },
  {
    id: "3",
    name: "Ana Paula",
    phone: "(11) 99876-5432",
    email: "ana.paula@email.com",
    avatar: "AP",
    neighborhood: "Consolação",
    address: "Rua Augusta, 200, apto 10",
    lastMessage: "Perfeito! Muito obrigada",
    lastTime: "11:58",
    unread: 0,
    online: false,
    joinDate: "2024-05-20",
    totalOrders: 9,
    totalSpent: 202.5,
  },
  {
    id: "4",
    name: "Roberto Lima",
    phone: "(11) 97654-3210",
    email: "roberto.lima@email.com",
    avatar: "RL",
    neighborhood: "Pinheiros",
    address: "Rua Teodoro Sampaio, 880",
    lastMessage: "Tem marmita fit hoje?",
    lastTime: "11:45",
    unread: 0,
    online: false,
    joinDate: "2024-07-12",
    totalOrders: 5,
    totalSpent: 127.5,
  },
  {
    id: "5",
    name: "Claudia Souza",
    phone: "(11) 96543-2109",
    email: "claudia.souza@email.com",
    avatar: "CS",
    neighborhood: "Jardins",
    address: "Rua Oscar Freire, 55",
    lastMessage: "Pode incluir sem cebola por favor",
    lastTime: "11:20",
    unread: 0,
    online: true,
    joinDate: "2024-02-01",
    totalOrders: 24,
    totalSpent: 610.0,
  },
  {
    id: "6",
    name: "Pedro Alves",
    phone: "(11) 95432-1098",
    email: "pedro.alves@email.com",
    avatar: "PA",
    neighborhood: "Cerqueira César",
    address: "Alameda Santos, 1200",
    lastMessage: "Marmita chegou, estava ótima!",
    lastTime: "10:55",
    unread: 0,
    online: false,
    joinDate: "2024-04-18",
    totalOrders: 11,
    totalSpent: 253.0,
  },
  {
    id: "7",
    name: "Fernanda Costa",
    phone: "(11) 94321-0987",
    email: "fernanda.costa@email.com",
    avatar: "FC",
    neighborhood: "Moema",
    address: "Av. Ibirapuera, 3100",
    lastMessage: "Boa tarde! Quero confirmar o pedido",
    lastTime: "14:02",
    unread: 2,
    online: true,
    joinDate: "2024-06-05",
    totalOrders: 15,
    totalSpent: 375.0,
  },
  {
    id: "8",
    name: "Lucas Mendes",
    phone: "(11) 93210-9876",
    email: "lucas.mendes@email.com",
    avatar: "LM",
    neighborhood: "Itaim Bibi",
    address: "Rua Joaquim Floriano, 820",
    lastMessage: "Pode adicionar mais arroz?",
    lastTime: "13:40",
    unread: 0,
    online: false,
    joinDate: "2024-08-22",
    totalOrders: 7,
    totalSpent: 168.0,
  },
];

// ─── Messages ─────────────────────────────────────────────────────────────────

export const messages: Record<string, Message[]> = {
  "1": [
    { id: "m1", from: "client", text: "Oi! Bom dia! Vi que vocês tem marmitas de frango hoje", time: "12:28" },
    { id: "m2", from: "restaurant", text: "Bom dia, Maria! Sim, temos frango grelhado, frango ensopado e frango à milanesa", time: "12:29" },
    { id: "m3", from: "client", text: "Que delícia! Quero pedir 2 marmitas de frango grelhado com arroz, feijão, farofa e salada", time: "12:31" },
    { id: "m4", from: "restaurant", text: "Perfeito! Vou registrar seu pedido. Endereço de entrega?", time: "12:32" },
    { id: "m5", from: "client", text: "Rua das Flores, 342, apto 52 - Vila Madalena", time: "12:33" },
    { id: "m6", from: "client", text: "Quero pedir 2 marmitas de frango grelhado", time: "12:34", orderId: "ORD-001" },
  ],
  "2": [
    { id: "m1", from: "client", text: "Olá! Fiz um pedido de picanha com arroz e batata frita", time: "12:15" },
    { id: "m2", from: "restaurant", text: "Oi João! Seu pedido foi confirmado e já está sendo preparado", time: "12:16" },
    { id: "m3", from: "client", text: "Quanto tempo demora a entrega?", time: "12:20", orderId: "ORD-002" },
  ],
  "3": [
    { id: "m1", from: "client", text: "Quero 1 marmita vegetariana por favor", time: "11:50", orderId: "ORD-003" },
    { id: "m2", from: "restaurant", text: "Claro Ana! Temos legumes grelhados com quinoa, quibe de couve-flor e lasanha de berinjela", time: "11:52" },
    { id: "m3", from: "client", text: "Vou querer a lasanha de berinjela!", time: "11:54" },
    { id: "m4", from: "restaurant", text: "Anotado! Seu pedido sai em breve", time: "11:56" },
    { id: "m5", from: "client", text: "Perfeito! Muito obrigada", time: "11:58" },
  ],
  "4": [
    { id: "m1", from: "client", text: "Tem marmita fit hoje?", time: "11:45" },
  ],
  "5": [
    { id: "m1", from: "client", text: "Bom dia! Quero 3 marmitas de feijoada", time: "11:10", orderId: "ORD-004" },
    { id: "m2", from: "restaurant", text: "Bom dia Claudia! Anotado, 3 feijoadas", time: "11:12" },
    { id: "m3", from: "client", text: "Pode incluir sem cebola por favor", time: "11:20" },
  ],
  "6": [
    { id: "m1", from: "client", text: "Quero 1 marmita de bife acebolado", time: "10:30", orderId: "ORD-005" },
    { id: "m2", from: "restaurant", text: "Pedido confirmado Pedro!", time: "10:32" },
    { id: "m3", from: "client", text: "Marmita chegou, estava ótima!", time: "10:55" },
    { id: "m4", from: "restaurant", text: "Fico muito feliz! Obrigado Pedro", time: "10:56" },
  ],
  "7": [
    { id: "m1", from: "client", text: "Boa tarde! Quero confirmar o pedido de 2 marmitas executivas", time: "13:58", orderId: "ORD-006" },
    { id: "m2", from: "restaurant", text: "Confirmado Fernanda! 2 marmitas executivas a caminho.", time: "14:00" },
    { id: "m3", from: "client", text: "Boa tarde! Quero confirmar o pedido", time: "14:02" },
  ],
  "8": [
    { id: "m1", from: "client", text: "Olá, tudo bem? Quero 1 marmita de frango à parmegiana", time: "13:35", orderId: "ORD-007" },
    { id: "m2", from: "restaurant", text: "Oi Lucas! Pedido recebido, vai sair em uns 40 min", time: "13:37" },
    { id: "m3", from: "client", text: "Pode adicionar mais arroz?", time: "13:40" },
  ],
};

// ─── Orders ───────────────────────────────────────────────────────────────────

export const orders: Order[] = [
  {
    id: "ORD-001",
    contactId: "1",
    status: "preparando",
    items: [{ name: "Frango Grelhado", qty: 2, price: 18.9, size: "M", obs: "Arroz, feijão, farofa e salada" }],
    total: 37.8,
    address: "Rua das Flores, 342, apto 52",
    neighborhood: "Vila Madalena",
    createdAt: "12:34",
    date: "2025-05-07",
    deliveryTime: "45 min",
    payment: "pix",
  },
  {
    id: "ORD-002",
    contactId: "2",
    status: "confirmado",
    items: [{ name: "Picanha com Arroz e Batata Frita", qty: 1, price: 29.9, size: "G" }],
    total: 29.9,
    address: "Av. Paulista, 900, sala 12",
    neighborhood: "Bela Vista",
    createdAt: "12:20",
    date: "2025-05-07",
    deliveryTime: "30 min",
    payment: "cartao_credito",
  },
  {
    id: "ORD-003",
    contactId: "3",
    status: "pronto",
    items: [{ name: "Lasanha de Berinjela", qty: 1, price: 22.5, size: "M" }],
    total: 22.5,
    address: "Rua Augusta, 200, apto 10",
    neighborhood: "Consolação",
    createdAt: "11:54",
    date: "2025-05-07",
    payment: "pix",
  },
  {
    id: "ORD-004",
    contactId: "5",
    status: "aguardando",
    items: [{ name: "Feijoada Completa", qty: 3, price: 25.0, size: "G", obs: "Sem cebola" }],
    total: 75.0,
    address: "Rua Oscar Freire, 55",
    neighborhood: "Jardins",
    createdAt: "11:20",
    date: "2025-05-07",
    deliveryTime: "60 min",
    payment: "dinheiro",
  },
  {
    id: "ORD-005",
    contactId: "6",
    status: "saiu",
    items: [{ name: "Bife Acebolado", qty: 1, price: 21.0, size: "M" }],
    total: 21.0,
    address: "Alameda Santos, 1200",
    neighborhood: "Cerqueira César",
    createdAt: "10:30",
    date: "2025-05-07",
    payment: "pix",
  },
  {
    id: "ORD-006",
    contactId: "7",
    status: "aguardando",
    items: [{ name: "Marmita Executiva", qty: 2, price: 24.5, size: "M" }],
    total: 49.0,
    address: "Av. Ibirapuera, 3100",
    neighborhood: "Moema",
    createdAt: "14:02",
    date: "2025-05-07",
    deliveryTime: "50 min",
    payment: "cartao_debito",
  },
  {
    id: "ORD-007",
    contactId: "8",
    status: "preparando",
    items: [{ name: "Frango à Parmegiana", qty: 1, price: 23.9, size: "G", obs: "Arroz extra" }],
    total: 23.9,
    address: "Rua Joaquim Floriano, 820",
    neighborhood: "Itaim Bibi",
    createdAt: "13:37",
    date: "2025-05-07",
    deliveryTime: "40 min",
    payment: "pix",
  },
  {
    id: "ORD-008",
    contactId: "1",
    status: "saiu",
    items: [{ name: "Frango Grelhado", qty: 1, price: 18.9, size: "P" }],
    total: 18.9,
    address: "Rua das Flores, 342, apto 52",
    neighborhood: "Vila Madalena",
    createdAt: "12:00",
    date: "2025-05-07",
    payment: "pix",
  },
  {
    id: "ORD-009",
    contactId: "2",
    status: "pronto",
    items: [{ name: "Strogonoff de Frango", qty: 2, price: 19.9, size: "M" }],
    total: 39.8,
    address: "Av. Paulista, 900, sala 12",
    neighborhood: "Bela Vista",
    createdAt: "11:30",
    date: "2025-05-07",
    payment: "cartao_credito",
  },
  {
    id: "ORD-010",
    contactId: "5",
    status: "confirmado",
    items: [{ name: "Feijoada Completa", qty: 2, price: 25.0, size: "G" }],
    total: 50.0,
    address: "Rua Oscar Freire, 55",
    neighborhood: "Jardins",
    createdAt: "11:00",
    date: "2025-05-07",
    payment: "dinheiro",
  },
  {
    id: "ORD-011",
    contactId: "3",
    status: "aguardando",
    items: [{ name: "Marmita Vegetariana", qty: 1, price: 22.5, size: "M" }],
    total: 22.5,
    address: "Rua Augusta, 200, apto 10",
    neighborhood: "Consolação",
    createdAt: "10:20",
    date: "2025-05-07",
    payment: "pix",
  },
  {
    id: "ORD-012",
    contactId: "7",
    status: "saiu",
    items: [{ name: "Marmita Executiva", qty: 3, price: 24.5, size: "G" }],
    total: 73.5,
    address: "Av. Ibirapuera, 3100",
    neighborhood: "Moema",
    createdAt: "13:15",
    date: "2025-05-07",
    payment: "cartao_credito",
  },
  {
    id: "ORD-013",
    contactId: "6",
    status: "confirmado",
    items: [{ name: "Bife Acebolado", qty: 2, price: 21.0, size: "M" }],
    total: 42.0,
    address: "Alameda Santos, 1200",
    neighborhood: "Cerqueira César",
    createdAt: "12:40",
    date: "2025-05-07",
    payment: "pix",
  },
  {
    id: "ORD-014",
    contactId: "4",
    status: "pronto",
    items: [{ name: "Marmita Fit", qty: 2, price: 26.0, size: "M" }],
    total: 52.0,
    address: "Rua Teodoro Sampaio, 880",
    neighborhood: "Pinheiros",
    createdAt: "12:15",
    date: "2025-05-07",
    payment: "cartao_debito",
  },
  {
    id: "ORD-015",
    contactId: "8",
    status: "preparando",
    items: [{ name: "Frango à Parmegiana", qty: 1, price: 23.9, size: "G" }],
    total: 23.9,
    address: "Rua Joaquim Floriano, 820",
    neighborhood: "Itaim Bibi",
    createdAt: "11:50",
    date: "2025-05-07",
    payment: "pix",
  },
];

// ─── Monthly report data (last 6 months) ──��───────────────────────────────────

export const monthlyData: MonthlyData[] = [
  { month: "Dez", revenue: 3240.0, orders: 148, avgTicket: 21.9 },
  { month: "Jan", revenue: 2980.5, orders: 131, avgTicket: 22.75 },
  { month: "Fev", revenue: 3512.0, orders: 158, avgTicket: 22.22 },
  { month: "Mar", revenue: 4105.5, orders: 178, avgTicket: 23.06 },
  { month: "Abr", revenue: 3890.0, orders: 164, avgTicket: 23.72 },
  { month: "Mai", revenue: 4620.8, orders: 193, avgTicket: 23.94 },
];

// ─── Daily data (last 14 days) ────────────────────────────────────────────────

export const dailyData: DailyData[] = [
  { day: "24/04", orders: 11 },
  { day: "25/04", orders: 14 },
  { day: "26/04", orders: 9 },
  { day: "27/04", orders: 17 },
  { day: "28/04", orders: 13 },
  { day: "29/04", orders: 18 },
  { day: "30/04", orders: 12 },
  { day: "01/05", orders: 15 },
  { day: "02/05", orders: 19 },
  { day: "03/05", orders: 16 },
  { day: "04/05", orders: 21 },
  { day: "05/05", orders: 14 },
  { day: "06/05", orders: 18 },
  { day: "07/05", orders: 7 },
];

// ─── Top items ────────────��───────────────────────────────────────────────────

export const topItems: TopItem[] = [
  { name: "Frango Grelhado",       qty: 312, revenue: 5896.8  },
  { name: "Feijoada Completa",     qty: 218, revenue: 5450.0  },
  { name: "Marmita Executiva",     qty: 195, revenue: 4777.5  },
  { name: "Picanha c/ Arroz",      qty: 143, revenue: 4276.7  },
  { name: "Frango à Parmegiana",   qty: 131, revenue: 3130.9  },
  { name: "Lasanha de Berinjela",  qty: 98,  revenue: 2205.0  },
  { name: "Strogonoff de Frango",  qty: 87,  revenue: 1731.3  },
  { name: "Marmita Fit",           qty: 74,  revenue: 1924.0  },
];

// ─── Menu items (cardápio) ────────────────────────────────────────────────────

export const menuItems: MenuItem[] = [
  {
    id: "MI-001",
    name: "Frango Grelhado",
    description: "Frango grelhado temperado na hora, acompanhado de arroz branco, feijão carioca, farofa e salada mista.",
    price: 18.9,
    category: "proteinas",
    available: true,
    popular: true,
    calories: 520,
    availableDays: ["seg", "ter", "qua", "qui", "sex"],
    sizes: [
      { id: "s-001-p", name: "P", price: 14.9 },
      { id: "s-001-m", name: "M", price: 18.9 },
      { id: "s-001-g", name: "G", price: 23.9 },
    ],
  },
  {
    id: "MI-002",
    name: "Picanha com Arroz e Batata Frita",
    description: "Fatias de picanha grelhada ao ponto, arroz branco, batata frita crocante e vinagrete.",
    price: 29.9,
    category: "proteinas",
    available: true,
    popular: true,
    calories: 780,
    availableDays: ["sex", "sab", "dom"],
    sizes: [
      { id: "s-002-m", name: "M", price: 25.9 },
      { id: "s-002-g", name: "G", price: 29.9 },
      { id: "s-002-f", name: "Família", price: 54.9 },
    ],
  },
  {
    id: "MI-003",
    name: "Bife Acebolado",
    description: "Bife de contra-filé com cebolas caramelizadas, arroz, feijão e purê de mandioca.",
    price: 21.0,
    category: "proteinas",
    available: true,
    popular: false,
    calories: 610,
    availableDays: ["seg", "qua", "sex"],
  },
  {
    id: "MI-004",
    name: "Frango à Parmegiana",
    description: "Filé de frango empanado coberto com molho de tomate caseiro e queijo muçarela gratinado.",
    price: 23.9,
    category: "proteinas",
    available: true,
    popular: true,
    calories: 690,
    availableDays: ["ter", "qui", "sab"],
  },
  {
    id: "MI-005",
    name: "Strogonoff de Frango",
    description: "Strogonoff cremoso de frango com creme de leite, arroz branco e batata palha.",
    price: 19.9,
    category: "proteinas",
    available: true,
    popular: false,
    calories: 600,
    availableDays: ["seg", "ter", "qua", "qui", "sex"],
  },
  {
    id: "MI-006",
    name: "Feijoada Completa",
    description: "Feijoada tradicional com costelinha, linguiça, toucinho e couve refogada. Acompanha arroz, farofa e laranja.",
    price: 25.0,
    category: "especial",
    available: true,
    popular: true,
    calories: 850,
    availableDays: ["sab"],
  },
  {
    id: "MI-007",
    name: "Lasanha de Berinjela",
    description: "Lasanha vegetariana com berinjela grelhada, ricota temperada, molho de tomate fresco e queijo.",
    price: 22.5,
    category: "vegetariano",
    available: true,
    popular: false,
    calories: 460,
    availableDays: ["ter", "qui"],
  },
  {
    id: "MI-008",
    name: "Marmita Vegetariana",
    description: "Legumes grelhados variados, grão-de-bico ao molho, arroz integral e salada de folhas.",
    price: 22.5,
    category: "vegetariano",
    available: true,
    popular: false,
    calories: 390,
    availableDays: ["seg", "ter", "qua", "qui", "sex"],
  },
  {
    id: "MI-009",
    name: "Marmita Fit",
    description: "Frango grelhado sem tempero industrializado, arroz integral, brócolis no vapor e cenoura.",
    price: 26.0,
    category: "fit",
    available: true,
    popular: true,
    calories: 420,
    availableDays: ["seg", "ter", "qua", "qui", "sex"],
  },
  {
    id: "MI-010",
    name: "Bowl Proteico",
    description: "Base de quinoa, frango desfiado temperado, grão-de-bico, cenoura ralada e molho de iogurte.",
    price: 28.5,
    category: "fit",
    available: true,
    popular: false,
    calories: 480,
    availableDays: ["seg", "qua", "sex"],
  },
  {
    id: "MI-011",
    name: "Marmita Executiva",
    description: "Prato do dia com opções rotativas de carne, frango ou peixe, dois acompanhamentos e sobremesa.",
    price: 24.5,
    category: "executiva",
    available: true,
    popular: true,
    calories: 650,
    availableDays: ["seg", "ter", "qua", "qui", "sex"],
  },
  {
    id: "MI-012",
    name: "Executiva Premium",
    description: "Carne nobre do dia (alcatra, fraldinha ou filé), três acompanhamentos à escolha e suco incluído.",
    price: 34.9,
    category: "executiva",
    available: false,
    popular: false,
    calories: 720,
    availableDays: ["sex", "sab"],
  },
];

export const drinkItems: DrinkItem[] = [
  { id: "DR-001", name: "Coca-Cola Lata 350ml", description: "Refrigerante gelado.", price: 5.0, category: "refrigerantes", available: true, popular: true, volume: "350ml", availableDays: ["seg","ter","qua","qui","sex","sab","dom"] },
  { id: "DR-002", name: "Guaraná Antarctica 350ml", description: "Refrigerante de guaraná gelado.", price: 5.0, category: "refrigerantes", available: true, popular: false, volume: "350ml", availableDays: ["seg","ter","qua","qui","sex","sab","dom"] },
  { id: "DR-003", name: "Suco de Laranja Natural 300ml", description: "Suco espremido na hora, sem adição de açúcar.", price: 8.0, category: "sucos", available: true, popular: true, volume: "300ml", availableDays: ["seg","ter","qua","qui","sex"] },
  { id: "DR-004", name: "Suco de Maracujá Natural 300ml", description: "Suco de maracujá com água de coco.", price: 8.5, category: "sucos", available: true, popular: false, volume: "300ml", availableDays: ["seg","ter","qua","qui","sex"] },
  { id: "DR-005", name: "Suco de Abacaxi com Hortelã 300ml", description: "Combinação refrescante de abacaxi e hortelã fresca.", price: 9.0, category: "sucos", available: true, popular: true, volume: "300ml", availableDays: ["seg","ter","qua","qui","sex","sab"] },
  { id: "DR-006", name: "Água sem Gás 500ml", description: "Água mineral natural.", price: 3.0, category: "agua", available: true, popular: false, volume: "500ml", availableDays: ["seg","ter","qua","qui","sex","sab","dom"] },
  { id: "DR-007", name: "Água com Gás 500ml", description: "Água mineral gaseificada.", price: 4.0, category: "agua", available: true, popular: false, volume: "500ml", availableDays: ["seg","ter","qua","qui","sex","sab","dom"] },
  { id: "DR-008", name: "Cerveja Heineken Long Neck 330ml", description: "Cerveja premium importada gelada.", price: 10.0, category: "alcoolicas", available: true, popular: true, volume: "330ml", availableDays: ["sex","sab","dom"] },
  { id: "DR-009", name: "Caipirinha de Limão", description: "Caipirinha artesanal com limão taiti, cachaça e açúcar.", price: 14.0, category: "alcoolicas", available: true, popular: false, volume: "300ml", availableDays: ["sab","dom"] },
  { id: "DR-010", name: "Café Expresso", description: "Café expresso forte e encorpado.", price: 5.0, category: "quentes", available: true, popular: false, volume: "50ml", availableDays: ["seg","ter","qua","qui","sex"] },
  { id: "DR-011", name: "Café com Leite", description: "Café coado com leite quente cremoso.", price: 7.0, category: "quentes", available: true, popular: true, volume: "200ml", availableDays: ["seg","ter","qua","qui","sex"] },
  { id: "DR-012", name: "Chá Gelado de Pêssego", description: "Chá gelado artesanal de pêssego com hortelã.", price: 7.5, category: "quentes", available: false, popular: false, volume: "300ml", availableDays: ["seg","ter","qua","qui","sex","sab"] },
];

export const drinkCategoryLabels: Record<DrinkCategory, string> = {
  refrigerantes: "Refrigerantes",
  sucos:         "Sucos Naturais",
  agua:          "Água",
  alcoolicas:    "Bebidas Alcoólicas",
  quentes:       "Bebidas Quentes",
};

export const drinkCategoryColors: Record<DrinkCategory, string> = {
  refrigerantes: "bg-red-100 text-red-700",
  sucos:         "bg-orange-100 text-orange-700",
  agua:          "bg-sky-100 text-sky-700",
  alcoolicas:    "bg-yellow-100 text-yellow-800",
  quentes:       "bg-amber-100 text-amber-800",
};

export const weekdayLabels: Record<Weekday, string> = {
  seg: "Seg",
  ter: "Ter",
  qua: "Qua",
  qui: "Qui",
  sex: "Sex",
  sab: "Sáb",
  dom: "Dom",
};

export const ALL_WEEKDAYS: Weekday[] = ["seg","ter","qua","qui","sex","sab","dom"];

export const categoryLabels: Record<MenuCategory, string> = {
  proteinas: "Proteínas",
  vegetariano: "Vegetariano",
  fit: "Fit & Saudável",
  executiva: "Executiva",
  especial: "Especiais",
};

export const categoryColors: Record<MenuCategory, string> = {
  proteinas: "bg-orange-100 text-orange-700",
  vegetariano: "bg-green-100 text-green-700",
  fit: "bg-teal-100 text-teal-700",
  executiva: "bg-blue-100 text-blue-700",
  especial: "bg-amber-100 text-amber-800",
};

// ─── Payment label helpers ────────────────────────────────────────────────────

export const paymentLabels: Record<PaymentMethod, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  cartao_credito: "Cartão Crédito",
  cartao_debito: "Cartão Débito",
};

export const statusLabels: Record<OrderStatus, string> = {
  aguardando: "Aguardando Confirmação",
  confirmado:  "Confirmado",
  preparando:  "Em Preparo",
  pronto:      "Pronto",
  saiu:        "Saiu para Entrega",
  entregue:    "Entregue",
};
