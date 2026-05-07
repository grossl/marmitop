export type OrderStatus = "novo" | "preparando" | "pronto" | "entregue";

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
  createdAt: string;
  deliveryTime?: string;
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
  avatar: string;
  lastMessage: string;
  lastTime: string;
  unread: number;
  online: boolean;
}

export const contacts: Contact[] = [
  {
    id: "1",
    name: "Maria Fernanda",
    phone: "(11) 98765-4321",
    avatar: "MF",
    lastMessage: "Quero pedir 2 marmitas de frango grelhado",
    lastTime: "12:34",
    unread: 3,
    online: true,
  },
  {
    id: "2",
    name: "João Carlos",
    phone: "(11) 91234-5678",
    avatar: "JC",
    lastMessage: "Quanto tempo demora a entrega?",
    lastTime: "12:20",
    unread: 1,
    online: true,
  },
  {
    id: "3",
    name: "Ana Paula",
    phone: "(11) 99876-5432",
    avatar: "AP",
    lastMessage: "Perfeito! Muito obrigada 😊",
    lastTime: "11:58",
    unread: 0,
    online: false,
  },
  {
    id: "4",
    name: "Roberto Lima",
    phone: "(11) 97654-3210",
    avatar: "RL",
    lastMessage: "Tem marmita fit hoje?",
    lastTime: "11:45",
    unread: 0,
    online: false,
  },
  {
    id: "5",
    name: "Claudia Souza",
    phone: "(11) 96543-2109",
    avatar: "CS",
    lastMessage: "Pode incluir sem cebola por favor",
    lastTime: "11:20",
    unread: 0,
    online: true,
  },
  {
    id: "6",
    name: "Pedro Alves",
    phone: "(11) 95432-1098",
    avatar: "PA",
    lastMessage: "Marmita chegou, estava ótima!",
    lastTime: "10:55",
    unread: 0,
    online: false,
  },
];

export const messages: Record<string, Message[]> = {
  "1": [
    {
      id: "m1",
      from: "client",
      text: "Oi! Bom dia! Vi que vocês tem marmitas de frango hoje",
      time: "12:28",
    },
    {
      id: "m2",
      from: "restaurant",
      text: "Bom dia, Maria! Sim, temos frango grelhado, frango ensopado e frango à milanesa 🍗",
      time: "12:29",
    },
    {
      id: "m3",
      from: "client",
      text: "Que delícia! Quero pedir 2 marmitas de frango grelhado com arroz, feijão, farofa e salada",
      time: "12:31",
    },
    {
      id: "m4",
      from: "restaurant",
      text: "Perfeito! Vou registrar seu pedido. Endereço de entrega?",
      time: "12:32",
    },
    {
      id: "m5",
      from: "client",
      text: "Rua das Flores, 342, apto 52 - Vila Madalena",
      time: "12:33",
    },
    {
      id: "m6",
      from: "client",
      text: "Quero pedir 2 marmitas de frango grelhado",
      time: "12:34",
      orderId: "ORD-001",
    },
  ],
  "2": [
    {
      id: "m1",
      from: "client",
      text: "Olá! Fiz um pedido de picanha com arroz e batata frita",
      time: "12:15",
    },
    {
      id: "m2",
      from: "restaurant",
      text: "Oi João! Seu pedido foi confirmado e já está sendo preparado 🔥",
      time: "12:16",
    },
    {
      id: "m3",
      from: "client",
      text: "Quanto tempo demora a entrega?",
      time: "12:20",
      orderId: "ORD-002",
    },
  ],
  "3": [
    {
      id: "m1",
      from: "client",
      text: "Quero 1 marmita vegetariana por favor",
      time: "11:50",
      orderId: "ORD-003",
    },
    {
      id: "m2",
      from: "restaurant",
      text: "Claro Ana! Temos legumes grelhados com quinoa, quibe de couve-flor e lasanha de berinjela 🥦",
      time: "11:52",
    },
    {
      id: "m3",
      from: "client",
      text: "Vou querer a lasanha de berinjela!",
      time: "11:54",
    },
    {
      id: "m4",
      from: "restaurant",
      text: "Anotado! Seu pedido sai em breve 💚",
      time: "11:56",
    },
    {
      id: "m5",
      from: "client",
      text: "Perfeito! Muito obrigada 😊",
      time: "11:58",
    },
  ],
  "4": [
    {
      id: "m1",
      from: "client",
      text: "Tem marmita fit hoje?",
      time: "11:45",
    },
  ],
  "5": [
    {
      id: "m1",
      from: "client",
      text: "Bom dia! Quero 3 marmitas de feijoada",
      time: "11:10",
      orderId: "ORD-004",
    },
    {
      id: "m2",
      from: "restaurant",
      text: "Bom dia Claudia! Anotado, 3 feijoadas 🍲",
      time: "11:12",
    },
    {
      id: "m3",
      from: "client",
      text: "Pode incluir sem cebola por favor",
      time: "11:20",
    },
  ],
  "6": [
    {
      id: "m1",
      from: "client",
      text: "Quero 1 marmita de bife acebolado",
      time: "10:30",
      orderId: "ORD-005",
    },
    {
      id: "m2",
      from: "restaurant",
      text: "Pedido confirmado Pedro! 🥩",
      time: "10:32",
    },
    {
      id: "m3",
      from: "client",
      text: "Marmita chegou, estava ótima!",
      time: "10:55",
    },
    {
      id: "m4",
      from: "restaurant",
      text: "Fico muito feliz! Obrigado Pedro 😊",
      time: "10:56",
    },
  ],
};

export const orders: Order[] = [
  {
    id: "ORD-001",
    contactId: "1",
    status: "preparando",
    items: [
      { name: "Frango Grelhado", qty: 2, price: 18.9, obs: "Com arroz, feijão, farofa e salada" },
    ],
    total: 37.8,
    address: "Rua das Flores, 342, apto 52 - Vila Madalena",
    createdAt: "12:34",
    deliveryTime: "45 min",
  },
  {
    id: "ORD-002",
    contactId: "2",
    status: "preparando",
    items: [{ name: "Picanha com Arroz e Batata Frita", qty: 1, price: 29.9 }],
    total: 29.9,
    address: "Av. Paulista, 900, sala 12",
    createdAt: "12:20",
    deliveryTime: "30 min",
  },
  {
    id: "ORD-003",
    contactId: "3",
    status: "pronto",
    items: [{ name: "Lasanha de Berinjela", qty: 1, price: 22.5 }],
    total: 22.5,
    address: "Rua Augusta, 200, apto 10",
    createdAt: "11:54",
  },
  {
    id: "ORD-004",
    contactId: "5",
    status: "novo",
    items: [{ name: "Feijoada Completa", qty: 3, price: 25.0, obs: "Sem cebola" }],
    total: 75.0,
    address: "Rua Oscar Freire, 55",
    createdAt: "11:20",
    deliveryTime: "60 min",
  },
  {
    id: "ORD-005",
    contactId: "6",
    status: "entregue",
    items: [{ name: "Bife Acebolado", qty: 1, price: 21.0 }],
    total: 21.0,
    address: "Alameda Santos, 1200",
    createdAt: "10:30",
  },
];
