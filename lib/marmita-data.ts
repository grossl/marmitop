// ─── Types ────────────────────────────────────────────────────────────────────

export type OrderStatus = "novo" | "preparando" | "pronto" | "entregue" | "cancelado";
export type PaymentMethod = "pix" | "dinheiro" | "cartao_credito" | "cartao_debito";
export type Section = "mensagens" | "pedidos" | "contatos" | "relatorios";

export interface OrderItem {
  name: string;
  qty: number;
  price: number;
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

// ─── Orders (today) ───────────────────────────────────────────────────────────

export const orders: Order[] = [
  {
    id: "ORD-001",
    contactId: "1",
    status: "preparando",
    items: [{ name: "Frango Grelhado", qty: 2, price: 18.9, obs: "Arroz, feijão, farofa e salada" }],
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
    status: "preparando",
    items: [{ name: "Picanha com Arroz e Batata Frita", qty: 1, price: 29.9 }],
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
    items: [{ name: "Lasanha de Berinjela", qty: 1, price: 22.5 }],
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
    status: "novo",
    items: [{ name: "Feijoada Completa", qty: 3, price: 25.0, obs: "Sem cebola" }],
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
    status: "entregue",
    items: [{ name: "Bife Acebolado", qty: 1, price: 21.0 }],
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
    status: "novo",
    items: [{ name: "Marmita Executiva", qty: 2, price: 24.5 }],
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
    items: [{ name: "Frango à Parmegiana", qty: 1, price: 23.9, obs: "Arroz extra" }],
    total: 23.9,
    address: "Rua Joaquim Floriano, 820",
    neighborhood: "Itaim Bibi",
    createdAt: "13:37",
    date: "2025-05-07",
    deliveryTime: "40 min",
    payment: "pix",
  },
  // Past orders for the table
  {
    id: "ORD-008",
    contactId: "1",
    status: "entregue",
    items: [{ name: "Frango Grelhado", qty: 1, price: 18.9 }],
    total: 18.9,
    address: "Rua das Flores, 342, apto 52",
    neighborhood: "Vila Madalena",
    createdAt: "12:00",
    date: "2025-05-06",
    payment: "pix",
  },
  {
    id: "ORD-009",
    contactId: "2",
    status: "entregue",
    items: [{ name: "Strogonoff de Frango", qty: 2, price: 19.9 }],
    total: 39.8,
    address: "Av. Paulista, 900, sala 12",
    neighborhood: "Bela Vista",
    createdAt: "11:30",
    date: "2025-05-06",
    payment: "cartao_credito",
  },
  {
    id: "ORD-010",
    contactId: "5",
    status: "entregue",
    items: [{ name: "Feijoada Completa", qty: 2, price: 25.0 }],
    total: 50.0,
    address: "Rua Oscar Freire, 55",
    neighborhood: "Jardins",
    createdAt: "11:00",
    date: "2025-05-05",
    payment: "dinheiro",
  },
  {
    id: "ORD-011",
    contactId: "3",
    status: "cancelado",
    items: [{ name: "Marmita Vegetariana", qty: 1, price: 22.5 }],
    total: 22.5,
    address: "Rua Augusta, 200, apto 10",
    neighborhood: "Consolação",
    createdAt: "10:20",
    date: "2025-05-05",
    payment: "pix",
  },
  {
    id: "ORD-012",
    contactId: "7",
    status: "entregue",
    items: [{ name: "Marmita Executiva", qty: 3, price: 24.5 }],
    total: 73.5,
    address: "Av. Ibirapuera, 3100",
    neighborhood: "Moema",
    createdAt: "13:15",
    date: "2025-05-04",
    payment: "cartao_credito",
  },
  {
    id: "ORD-013",
    contactId: "6",
    status: "entregue",
    items: [{ name: "Bife Acebolado", qty: 2, price: 21.0 }],
    total: 42.0,
    address: "Alameda Santos, 1200",
    neighborhood: "Cerqueira César",
    createdAt: "12:40",
    date: "2025-05-03",
    payment: "pix",
  },
  {
    id: "ORD-014",
    contactId: "4",
    status: "entregue",
    items: [{ name: "Marmita Fit", qty: 2, price: 26.0 }],
    total: 52.0,
    address: "Rua Teodoro Sampaio, 880",
    neighborhood: "Pinheiros",
    createdAt: "12:15",
    date: "2025-05-02",
    payment: "cartao_debito",
  },
  {
    id: "ORD-015",
    contactId: "8",
    status: "entregue",
    items: [{ name: "Frango à Parmegiana", qty: 1, price: 23.9 }],
    total: 23.9,
    address: "Rua Joaquim Floriano, 820",
    neighborhood: "Itaim Bibi",
    createdAt: "11:50",
    date: "2025-05-01",
    payment: "pix",
  },
];

// ─── Monthly report data (last 6 months) ──────────────────────────────────────

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

// ─── Top items ────────────────────────────────────────────────────────────────

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

// ─── Payment label helpers ────────────────────────────────────────────────────

export const paymentLabels: Record<PaymentMethod, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  cartao_credito: "Cartão Crédito",
  cartao_debito: "Cartão Débito",
};

export const statusLabels: Record<OrderStatus, string> = {
  novo: "Novo",
  preparando: "Preparando",
  pronto: "Pronto",
  entregue: "Entregue",
  cancelado: "Cancelado",
};
