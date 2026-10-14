#!/usr/bin/env bun
// scripts/dev-seed/generate.ts
//
// Writes supabase/seed.sql (11.operations.md "Local development"). Run with
// `bun run seed:generate`. The output is deterministic: a fixed PRNG seed,
// fixed uuids, and time expressions relative to the reset, so two runs are
// byte-identical and packages/db/src/seed.test.ts can detect drift.
//
// `supabase db reset` runs the file as the migration owner, so the inserts
// bypass RLS the way a DBA does. The triggers still run: order history rows,
// stock balances, the deferred subtotal check, and the secret-kind check.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  API_KEYS,
  apiKeyHash,
  apiKeyPrefix,
  DEV_APP_SERVICE_PASSWORD,
  DEV_DB_URL,
  DEV_KEK_BASE64,
  DEV_USER_PASSWORD,
  devUuid,
  FAKE_UATIS_BASE_URL,
  FAKE_WEBNF_BASE_URL,
  RESTAURANTS,
  SECRET_LIST,
  SECRETS,
  type SeedRestaurant,
  USER_LIST,
  USERS,
  UUID_FAMILY,
} from "./constants";
import {
  CASA,
  type ChatLine,
  type CustomerSpec,
  type MenuItemSpec,
  MINAS,
  type RestaurantContent,
  SYNTHETIC_FIRST_NAMES,
  SYNTHETIC_LAST_NAMES,
} from "./data";
import { sealDeterministic } from "./envelope";
import {
  bytea,
  insert,
  insertChunked,
  int,
  jsonb,
  localDayAt,
  minutesAgo,
  plusMinutes,
  SEED_AT_FUNCTION,
  section,
  smallintArray,
  str,
  strOrNull,
  textArray,
} from "./sql";

export const OUTPUT = fileURLToPath(new URL("../../supabase/seed.sql", import.meta.url));

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  private readonly next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float(): number {
    return this.next();
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error("pick from an empty list");
    return item;
  }
  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    const total = items.reduce((sum, item) => sum + weight(item), 0);
    let r = this.next() * total;
    for (const item of items) {
      r -= weight(item);
      if (r < 0) return item;
    }
    return items[items.length - 1] as T;
  }
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

interface CustomerRow {
  id: string;
  key: string;
  spec: CustomerSpec;
}

interface MenuRow {
  id: string;
  spec: MenuItemSpec;
  sizeIds: Map<string, string>;
}

interface OrderItemRow {
  id: string;
  menuItemId: string | null;
  name: string;
  sizeName: string | null;
  unitPriceCents: number;
  qty: number;
  notes: string | null;
  position: number;
}

type Status = "aguardando" | "confirmado" | "preparando" | "pronto" | "saiu" | "entregue" | "cancelado";

interface OrderRow {
  id: string;
  code: string;
  /** Sort key: larger is newer. */
  order: number;
  createdAt: string;
  customer: CustomerRow;
  status: Status;
  fulfillment: "delivery" | "pickup";
  payment: "pix" | "dinheiro" | "cartao_credito" | "cartao_debito";
  changeForCents: number | null;
  notes: string | null;
  items: OrderItemRow[];
  subtotalCents: number;
  feeCents: number;
  source: "counter" | "phone" | "whatsapp";
  conversationId: string | null;
  createdBy: string;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  /** ADR-020: `entregue` orders are paid at delivery; a Pix order on today's board in `pronto` or `saiu` was paid in advance. */
  paidAt: string | null;
  mockId: string | null;
}

interface MessageRow {
  id: string;
  conversationId: string;
  direction: "in" | "out";
  body: string;
  status: "delivered" | "read";
  orderMockId: string | null;
  sentBy: string | null;
  createdAt: string;
  minutesAgo: number;
}

interface ConversationRow {
  id: string;
  customer: CustomerRow;
  unread: number;
  lastAt: string;
  lastInboundAt: string | null;
  preview: string;
  createdAt: string;
  messages: MessageRow[];
}

interface StockMovementRow {
  id: string;
  stockItemId: string;
  kind: "in" | "out";
  qty: number;
  reason: string;
  createdAt: string;
}

interface RestaurantModel {
  restaurant: SeedRestaurant;
  content: RestaurantContent;
  admin: (typeof USER_LIST)[number];
  attendant: (typeof USER_LIST)[number];
  customers: CustomerRow[];
  menu: MenuRow[];
  conversations: ConversationRow[];
  orders: OrderRow[];
  stock: { id: string; spec: RestaurantContent["stock"][number] }[];
  movements: StockMovementRow[];
}

const counters = new Map<string, number>();
function nextId(family: string): string {
  const n = (counters.get(family) ?? 0) + 1;
  counters.set(family, n);
  return devUuid(family, n);
}

/** Minutes before the reset for a prototype wall-clock time (the prototype's "now" is 14:10). */
function prototypeMinutesAgo(time: string): number {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return 14 * 60 + 10 - (h * 60 + m);
}

function buildRestaurant(restaurant: SeedRestaurant, content: RestaurantContent, seed: number): RestaurantModel {
  const rng = new Rng(seed);
  const admin = restaurant.key === "casa" ? USERS.casaAdmin : USERS.minasAdmin;
  const attendant = restaurant.key === "casa" ? USERS.casaAttendant : USERS.minasAttendant;

  // Customers: the named ones plus synthetic regulars for the history.
  const customers: CustomerRow[] = content.customers.map((spec) => ({
    id: nextId(UUID_FAMILY.customer),
    key: spec.key,
    spec,
  }));
  const ddd = restaurant.uf === "SP" ? "11" : "31";
  for (let i = 0; i < content.syntheticCustomers; i += 1) {
    const first = SYNTHETIC_FIRST_NAMES[(i * 7 + seed) % SYNTHETIC_FIRST_NAMES.length] as string;
    const last = SYNTHETIC_LAST_NAMES[(i * 3 + seed) % SYNTHETIC_LAST_NAMES.length] as string;
    const place = content.bairros[i % content.bairros.length];
    if (place === undefined) throw new Error("no bairros");
    const spec: CustomerSpec = {
      key: `synthetic-${i + 1}`,
      name: `${first} ${last}`,
      phone: `+55${ddd}9${String(70_000_000 + seed * 1000 + i * 37).padStart(8, "0")}`,
      email: null,
      cpfCnpj: null,
      address: {
        cep: place.cep,
        logradouro: place.logradouro,
        numero: String(rng.int(10, 1999)),
        complemento: rng.float() < 0.4 ? `apto ${rng.int(11, 154)}` : null,
        bairro: place.bairro,
      },
      joinedDaysAgo: rng.int(20, 400),
      weight: 1,
    };
    customers.push({ id: nextId(UUID_FAMILY.customer), key: spec.key, spec });
  }
  const customerByKey = new Map(customers.map((c) => [c.key, c]));
  const customer = (key: string) => {
    const c = customerByKey.get(key);
    if (c === undefined) throw new Error(`unknown customer ${key}`);
    return c;
  };

  // Menu.
  const menu: MenuRow[] = content.menu.map((spec) => ({
    id: nextId(UUID_FAMILY.menuItem),
    spec,
    sizeIds: new Map(spec.sizes.map((s) => [s.name, nextId(UUID_FAMILY.menuSize)])),
  }));
  const menuByKey = new Map(menu.map((m) => [m.spec.key, m]));
  const meals = menu.filter((m) => m.spec.kind === "meal" && m.spec.weight > 0);
  const drinks = menu.filter((m) => m.spec.kind === "drink" && m.spec.available);

  const lineFor = (
    m: MenuRow,
    qty: number,
    size: string | null,
    notes: string | null,
    position: number,
  ): OrderItemRow => {
    let sizeName: string | null = null;
    let price = m.spec.priceCents;
    if (m.spec.sizes.length > 0) {
      const chosen = m.spec.sizes.find((s) => s.name === size) ?? m.spec.sizes[Math.min(1, m.spec.sizes.length - 1)];
      if (chosen === undefined) throw new Error("no size");
      sizeName = chosen.name;
      price = chosen.priceCents;
    }
    return {
      id: nextId(UUID_FAMILY.orderItem),
      menuItemId: m.id,
      name: m.spec.name,
      sizeName,
      unitPriceCents: price,
      qty,
      notes,
      position,
    };
  };

  // Conversations (prototype chats).
  const conversations: ConversationRow[] = content.conversations.map((spec) => {
    const id = nextId(UUID_FAMILY.conversation);
    const messages: MessageRow[] = spec.lines.map((line: ChatLine) => {
      const ago = prototypeMinutesAgo(line.time);
      return {
        id: nextId(UUID_FAMILY.message),
        conversationId: id,
        direction: line.from === "client" ? "in" : "out",
        body: line.text,
        status: line.from === "client" ? "delivered" : "read",
        orderMockId: line.orderId ?? null,
        sentBy: line.from === "client" ? null : attendant.id,
        createdAt: minutesAgo(ago),
        minutesAgo: ago,
      };
    });
    const last = messages[messages.length - 1];
    const lastInbound = [...messages].reverse().find((m) => m.direction === "in");
    const first = messages[0];
    if (last === undefined || first === undefined) throw new Error("empty conversation");
    return {
      id,
      customer: customer(spec.customerKey),
      unread: spec.unread,
      lastAt: last.createdAt,
      lastInboundAt: lastInbound?.createdAt ?? null,
      preview: last.body.slice(0, 120),
      createdAt: first.createdAt,
      messages,
    };
  });
  const conversationByCustomer = new Map(conversations.map((c) => [c.customer.id, c]));

  const fee = content.settings.deliveryFeeCents;
  const makeOrder = (
    o: Omit<OrderRow, "id" | "code" | "subtotalCents" | "feeCents" | "changeForCents" | "paidAt">,
  ): OrderRow => {
    const subtotal = o.items.reduce((sum, item) => sum + item.unitPriceCents * item.qty, 0);
    const feeCents = o.fulfillment === "delivery" ? fee : 0;
    const total = subtotal + feeCents;
    // No rng call here, so the generated history stays the same as before 0018.
    const paidAt =
      o.status === "entregue"
        ? o.deliveredAt
        : o.payment === "pix" && (o.status === "pronto" || o.status === "saiu")
          ? plusMinutes(o.createdAt, 5)
          : null;
    return {
      ...o,
      paidAt,
      id: nextId(UUID_FAMILY.order),
      code: "",
      subtotalCents: subtotal,
      feeCents,
      changeForCents: o.payment === "dinheiro" ? Math.ceil((total + 1) / 1000) * 1000 : null,
    };
  };

  const orders: OrderRow[] = [];

  // Historical orders: the 13 days before today from dailyOrders, then
  // 30-day blocks from monthlyOrders (block 0 already holds the 14-day window).
  const perDay = new Map<number, number>();
  content.dailyOrders.forEach((count, i) => {
    perDay.set(content.dailyOrders.length - i, count);
  });
  content.monthlyOrders.forEach((target, block) => {
    const first = block * 30;
    const candidates = Array.from({ length: 30 }, (_, i) => first + i).filter((d) => d > content.dailyOrders.length);
    // Block 0 overlaps the 14-day window, which dailyOrders already fills; its
    // other days get the block's daily rate.
    const remaining = Math.round((target * candidates.length) / 30);
    for (let i = 0; i < remaining && candidates.length > 0; i += 1) {
      const day = rng.pick(candidates);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
  });

  const historicalCustomers = customers;
  for (const [daysAgo, count] of [...perDay.entries()].sort((a, b) => b[0] - a[0])) {
    const times = Array.from({ length: count }, () => rng.int(10 * 60 + 30, 20 * 60 + 30)).sort((a, b) => a - b);
    for (const minuteOfDay of times) {
      const who = rng.weighted(
        historicalCustomers,
        (c) => c.spec.weight * (c.spec.joinedDaysAgo >= daysAgo ? 1 : 0.05),
      );
      const items: OrderItemRow[] = [];
      const mealCount = rng.float() < 0.75 ? 1 : 2;
      for (let i = 0; i < mealCount; i += 1) {
        const m = rng.weighted(meals, (x) => x.spec.weight);
        const size = m.spec.sizes.length > 0 ? rng.pick(m.spec.sizes).name : null;
        items.push(lineFor(m, rng.float() < 0.8 ? 1 : 2, size, null, items.length));
      }
      if (drinks.length > 0 && rng.float() < 0.35) {
        const d = rng.pick(drinks);
        const size = d.spec.sizes.length > 0 ? rng.pick(d.spec.sizes).name : null;
        items.push(lineFor(d, 1, size, null, items.length));
      }
      const createdAt = localDayAt(daysAgo, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
      const cancelled = rng.float() < 0.05;
      const fulfillment = rng.float() < 0.85 ? "delivery" : "pickup";
      const conversation = conversationByCustomer.get(who.id);
      const sourceRoll = rng.float();
      const source =
        conversation !== undefined && sourceRoll < 0.6 ? "whatsapp" : sourceRoll < 0.85 ? "counter" : "phone";
      orders.push(
        makeOrder({
          order: -daysAgo * 10_000 + minuteOfDay,
          createdAt,
          customer: who,
          status: cancelled ? "cancelado" : "entregue",
          fulfillment,
          payment: rng.pick(["pix", "pix", "pix", "cartao_credito", "cartao_debito", "dinheiro"] as const),
          notes: null,
          items,
          source,
          conversationId: source === "whatsapp" ? (conversation?.id ?? null) : null,
          createdBy: attendant.id,
          deliveredAt: cancelled ? null : plusMinutes(createdAt, rng.int(30, 60)),
          cancelledAt: cancelled ? plusMinutes(createdAt, rng.int(5, 20)) : null,
          cancelReason: cancelled
            ? rng.pick(["Cliente desistiu", "Endereço fora da área de entrega", "Item esgotado"])
            : null,
          mockId: null,
        }),
      );
    }
  }

  // Today's orders (the prototype board), relative to the reset.
  for (const spec of content.todayOrders) {
    const ago = prototypeMinutesAgo(spec.time);
    const who = customer(spec.customerKey);
    const items = spec.items.map((item, i) => {
      const m = menuByKey.get(item.menuKey);
      if (m === undefined) throw new Error(`unknown menu item ${item.menuKey}`);
      return lineFor(m, item.qty, item.size ?? null, item.notes ?? null, i);
    });
    const conversation = conversationByCustomer.get(who.id);
    const fromChat = conversation?.messages.some((message) => message.orderMockId === spec.mockId);
    const createdAt = minutesAgo(ago);
    orders.push(
      makeOrder({
        order: 1_000_000 - ago,
        createdAt,
        customer: who,
        status: spec.status,
        fulfillment: "delivery",
        payment: spec.payment,
        notes: spec.notes ?? null,
        items,
        source: fromChat ? "whatsapp" : "counter",
        conversationId: fromChat ? (conversation?.id ?? null) : null,
        createdBy: attendant.id,
        deliveredAt: spec.status === "entregue" ? plusMinutes(createdAt, 40) : null,
        cancelledAt: null,
        cancelReason: null,
        mockId: spec.mockId,
      }),
    );
  }

  orders.sort((a, b) => a.order - b.order);
  orders.forEach((order, i) => {
    const n = i + 1;
    order.code = `ORD-${n < 100 ? String(n).padStart(3, "0") : String(n)}`;
  });

  // Stock: an opening `in` and one `out`, so each item has a history.
  const stock = content.stock.map((spec) => ({ id: nextId(UUID_FAMILY.stockItem), spec }));
  const movements: StockMovementRow[] = stock.flatMap(({ id, spec }) => [
    {
      id: nextId(UUID_FAMILY.stockMovement),
      stockItemId: id,
      kind: "in" as const,
      qty: spec.current + spec.used,
      reason: "Compra semanal",
      createdAt: localDayAt(6, 8, 0),
    },
    {
      id: nextId(UUID_FAMILY.stockMovement),
      stockItemId: id,
      kind: "out" as const,
      qty: spec.used,
      reason: "Consumo da semana",
      createdAt: localDayAt(1, 18, 0),
    },
  ]);

  return { restaurant, content, admin, attendant, customers, menu, conversations, orders, stock, movements };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function header(): string {
  const lines = [
    "-- supabase/seed.sql",
    "--",
    "-- GENERATED FILE. Do not edit by hand. Regenerate with `bun run seed:generate`",
    "-- (scripts/dev-seed/generate.ts). `supabase db reset` runs it after the",
    "-- migrations, as the migration owner, so the inserts bypass RLS the way a DBA",
    "-- does. The applications still connect as `app_service` (nobypassrls).",
    "--",
    "-- ===========================================================================",
    "-- LOCAL DEVELOPMENT CREDENTIALS: for the `supabase start` stack only",
    "-- ===========================================================================",
    "-- Committed on purpose. None of these values opens anything outside a",
    "-- developer's machine. Do not copy them into a deployed environment.",
    "--",
    `-- Dashboard sign-in (http://localhost:3100). Password for every user: ${DEV_USER_PASSWORD}`,
    ...USER_LIST.map((u) => `--   ${u.email.padEnd(30)} ${u.role.padEnd(9)} ${u.restaurant.name}`),
    "--",
    `-- DATABASE_URL=${DEV_DB_URL}`,
    `-- MT_KEK=${DEV_KEK_BASE64}`,
    "--",
    "-- Public API keys (Authorization: Bearer ...):",
    ...API_KEYS.map((k) => `--   ${k.restaurant.name}: ${k.plaintext}${k.revoked ? "  [revoked: expect 401]" : ""}`),
    "-- ===========================================================================",
    "",
    "set standard_conforming_strings = on;",
    "",
    "begin;",
    "",
    SEED_AT_FUNCTION,
  ];
  return `${lines.join("\n")}\n`;
}

function localWiring(): string {
  return (
    section(
      "Local wiring",
      "Migration 0001 creates app_service `nologin`; each environment attaches a",
      "password out of band. On the local stack the seed is that out of band.",
    ) + `alter role app_service with login password ${str(DEV_APP_SERVICE_PASSWORD)};\n`
  );
}

/** GoTrue scans several token columns and breaks on NULLs, so they are empty strings. */
function authUsers(): string {
  const password = `extensions.crypt(${str(DEV_USER_PASSWORD)}, extensions.gen_salt('bf'))`;
  const users = insert(
    "auth.users",
    [
      "instance_id",
      "id",
      "aud",
      "role",
      "email",
      "encrypted_password",
      "email_confirmed_at",
      "raw_app_meta_data",
      "raw_user_meta_data",
      "created_at",
      "updated_at",
      "confirmation_token",
      "recovery_token",
      "email_change",
      "email_change_token_new",
      "email_change_token_current",
      "phone_change",
      "phone_change_token",
      "reauthentication_token",
    ],
    USER_LIST.map((u) => [
      str("00000000-0000-0000-0000-000000000000"),
      str(u.id),
      str("authenticated"),
      str("authenticated"),
      str(u.email),
      password,
      "now()",
      jsonb({ provider: "email", providers: ["email"] }),
      jsonb({ full_name: u.name }),
      "now()",
      "now()",
      "''",
      "''",
      "''",
      "''",
      "''",
      "''",
      "''",
      "''",
    ]),
  );
  const identities = insert(
    "auth.identities",
    ["id", "user_id", "provider_id", "provider", "identity_data", "last_sign_in_at", "created_at", "updated_at"],
    USER_LIST.map((u) => [
      str(u.identityId),
      str(u.id),
      str(u.id),
      str("email"),
      jsonb({ sub: u.id, email: u.email, email_verified: true, phone_verified: false }),
      "now()",
      "now()",
      "now()",
    ]),
  );
  return `${section("auth.users + auth.identities", "Email and password, already confirmed.")}${users}\n${identities}`;
}

function restaurants(models: RestaurantModel[]): string {
  const rows = models.map(({ restaurant: r }) => [
    str(r.id),
    str(r.name),
    str(r.phone),
    str(r.email),
    str(r.address),
    str(r.cidade),
    str(r.uf),
    str(r.codigoMunicipio),
    str(r.planCode),
  ]);
  const members = models.flatMap((m) => [
    [
      str(devUuid(UUID_FAMILY.member, USER_LIST.indexOf(m.admin) + 1)),
      str(m.restaurant.id),
      str(m.admin.id),
      str("admin"),
    ],
    [
      str(devUuid(UUID_FAMILY.member, USER_LIST.indexOf(m.attendant) + 1)),
      str(m.restaurant.id),
      str(m.attendant.id),
      str("attendant"),
    ],
  ]);
  const settings = models.map(({ restaurant: r, content: c }) => [
    str(r.id),
    String(c.settings.autoAccept),
    String(c.settings.allowPickup),
    String(c.settings.showDeliveryEstimate),
    int(c.settings.deliveryEstimateMinutes),
    int(c.settings.deliveryFeeCents),
    str("America/Sao_Paulo"),
  ]);
  let hoursN = 0;
  const hours = models.flatMap(({ restaurant: r, content: c }) =>
    c.hours.map((h) => [
      str(devUuid(UUID_FAMILY.hours, ++hoursN)),
      str(r.id),
      int(h.weekday),
      String(h.enabled),
      str(h.opens),
      str(h.closes),
    ]),
  );
  let autoN = 0;
  const autos = models.flatMap(({ restaurant: r, content: c }) =>
    c.automaticMessages.map((a) => [
      str(devUuid(UUID_FAMILY.autoMessage, ++autoN)),
      str(r.id),
      str(a.kind),
      String(a.enabled),
      str(a.body),
    ]),
  );
  return (
    section("restaurants, members, settings, hours, automatic messages (FR-009, FR-080–084)") +
    insert(
      "public.restaurants",
      ["id", "name", "phone", "email", "address", "cidade", "uf", "codigo_municipio", "plan_code"],
      rows,
    ) +
    "\n" +
    insert("public.restaurant_members", ["id", "restaurant_id", "user_id", "role"], members) +
    "\n" +
    insert(
      "public.restaurant_settings",
      [
        "restaurant_id",
        "auto_accept",
        "allow_pickup",
        "show_delivery_estimate",
        "delivery_estimate_minutes",
        "delivery_fee_cents",
        "timezone",
      ],
      settings,
    ) +
    "\n" +
    insert("public.business_hours", ["id", "restaurant_id", "weekday", "enabled", "opens_at", "closes_at"], hours) +
    "\n" +
    insert("public.automatic_messages", ["id", "restaurant_id", "kind", "enabled", "body"], autos)
  );
}

function integrations(): string {
  const secrets = SECRET_LIST.map((s) => {
    const sealed = sealDeterministic(DEV_KEK_BASE64, s.restaurant.id, s.id, s.kind, s.plaintext);
    return [
      str(s.id),
      str(s.restaurant.id),
      str(s.kind),
      bytea(sealed.ciphertext),
      bytea(sealed.iv),
      bytea(sealed.wrappedKey),
      "1",
      str(sealed.last4),
    ];
  });
  const whatsapp = [
    [RESTAURANTS.casa, SECRETS.casaUatisKey, SECRETS.casaUatisWebhook, "pn_casa_dev_5511999990000"],
    [RESTAURANTS.minas, SECRETS.minasUatisKey, SECRETS.minasUatisWebhook, "pn_minas_dev_5531988881111"],
  ] as const;
  return (
    section(
      "secrets and integrations (ADR-012)",
      "Envelope-encrypted under the dev MT_KEK (scripts/dev-seed/envelope.ts).",
      "Both integrations point at the fakes: run the apps with MT_UATIS_FAKE=1 and MT_WEBNF_FAKE=1.",
    ) +
    insert(
      "public.secrets",
      ["id", "restaurant_id", "kind", "ciphertext", "iv", "wrapped_key", "kek_version", "last4"],
      secrets,
    ) +
    "\n" +
    insert(
      "public.integrations_whatsapp",
      [
        "restaurant_id",
        "base_url",
        "api_key_secret_id",
        "webhook_secret_id",
        "phone_number_id",
        "status",
        "last_synced_at",
      ],
      whatsapp.map(([r, key, hook, phone]) => [
        str(r.id),
        str(FAKE_UATIS_BASE_URL),
        str(key.id),
        str(hook.id),
        str(phone),
        str("connected"),
        "now()",
      ]),
    ) +
    "\n" +
    insert(
      "public.integrations_fiscal",
      [
        "restaurant_id",
        "base_url",
        "api_key_secret_id",
        "webhook_secret_id",
        "environment",
        "nfce_serie",
        "nfe_serie",
        "default_ncm",
        "default_cfop",
        "default_csosn",
        "default_pis_cst",
        "default_cofins_cst",
        "delivery_fee_mode",
        "status",
      ],
      [
        [
          str(RESTAURANTS.casa.id),
          str(FAKE_WEBNF_BASE_URL),
          str(SECRETS.casaWebnfKey.id),
          str(SECRETS.casaWebnfWebhook.id),
          str("homologacao"),
          "1",
          "1",
          str("21069090"),
          str("5102"),
          str("102"),
          str("49"),
          str("49"),
          str("item"),
          str("connected"),
        ],
      ],
    ) +
    "\n" +
    insert(
      "public.api_keys",
      ["id", "restaurant_id", "name", "prefix", "hash", "environment", "created_by", "created_at", "revoked_at"],
      API_KEYS.map((k) => [
        str(k.id),
        str(k.restaurant.id),
        str(k.name),
        str(apiKeyPrefix(k)),
        str(apiKeyHash(k)),
        str("test"),
        str(k.restaurant.key === "casa" ? USERS.casaAdmin.id : USERS.minasAdmin.id),
        k.revoked ? localDayAt(40, 10, 0) : localDayAt(20, 10, 0),
        k.revoked ? localDayAt(21, 10, 0) : "null",
      ]),
    ) +
    "\n" +
    insert(
      "public.webhook_endpoints",
      ["id", "restaurant_id", "url", "secret_id", "enabled", "events"],
      [
        [
          str(devUuid(UUID_FAMILY.webhookEndpoint, 1)),
          str(RESTAURANTS.casa.id),
          str("http://127.0.0.1:4030/webhooks/marmitop"),
          str(SECRETS.casaOutbound.id),
          "false",
          textArray(["order.created", "order.status_changed", "message.received", "invoice.updated"]),
        ],
      ],
    )
  );
}

function catalogue(models: RestaurantModel[]): string {
  const items = models.flatMap((m) =>
    m.menu.map((row) => [
      str(row.id),
      str(m.restaurant.id),
      str(row.spec.kind),
      str(row.spec.name),
      str(row.spec.description),
      str(row.spec.category),
      int(row.spec.priceCents),
      row.spec.calories === null ? "null" : int(row.spec.calories),
      strOrNull(row.spec.volume),
      String(row.spec.available),
      String(row.spec.popular),
      smallintArray(row.spec.weekdays),
    ]),
  );
  const sizes = models.flatMap((m) =>
    m.menu.flatMap((row) =>
      row.spec.sizes.map((s, i) => [
        str(row.sizeIds.get(s.name) as string),
        str(m.restaurant.id),
        str(row.id),
        str(s.name),
        int(s.priceCents),
        int(i),
      ]),
    ),
  );
  const stock = models.flatMap((m) =>
    m.stock.map(({ id, spec }) => [
      str(id),
      str(m.restaurant.id),
      str(spec.name),
      str(spec.unit),
      str(spec.category),
      String(spec.minimum),
      int(spec.unitCostCents),
    ]),
  );
  const movements = models.flatMap((m) =>
    m.movements.map((mv) => [
      str(mv.id),
      str(m.restaurant.id),
      str(mv.stockItemId),
      str(mv.kind),
      String(mv.qty),
      "0",
      str(mv.reason),
      str(m.admin.id),
      mv.createdAt,
    ]),
  );
  return (
    section("menu (FR-050–058) and stock (FR-060–068)", "current_qty comes from the movements through the trigger.") +
    insert(
      "public.menu_items",
      [
        "id",
        "restaurant_id",
        "kind",
        "name",
        "description",
        "category",
        "price_cents",
        "calories",
        "volume",
        "available",
        "popular",
        "available_weekdays",
      ],
      items,
    ) +
    "\n" +
    insert(
      "public.menu_item_sizes",
      ["id", "restaurant_id", "menu_item_id", "name", "price_cents", "position"],
      sizes,
    ) +
    "\n" +
    insert(
      "public.stock_items",
      ["id", "restaurant_id", "name", "unit", "category", "minimum_qty", "unit_cost_cents"],
      stock,
    ) +
    "\n" +
    insert(
      "public.stock_movements",
      ["id", "restaurant_id", "stock_item_id", "kind", "qty", "balance_after", "reason", "created_by", "created_at"],
      movements,
    )
  );
}

function people(models: RestaurantModel[]): string {
  const customers = models.flatMap((m) =>
    m.customers.map((c) => [
      str(c.id),
      str(m.restaurant.id),
      str(c.spec.name),
      str(c.spec.phone),
      strOrNull(c.spec.email),
      strOrNull(c.spec.cpfCnpj),
      str(c.spec.address.cep),
      str(c.spec.address.logradouro),
      str(c.spec.address.numero),
      strOrNull(c.spec.address.complemento),
      str(c.spec.address.bairro),
      str(m.restaurant.cidade),
      str(m.restaurant.uf),
      str(m.restaurant.codigoMunicipio),
      localDayAt(c.spec.joinedDaysAgo, 12, 0),
    ]),
  );
  const conversations = models.flatMap((m) =>
    m.conversations.map((c, i) => [
      str(c.id),
      str(m.restaurant.id),
      str(c.customer.id),
      str(`conv_${m.restaurant.key}_${i + 1}`),
      c.lastAt,
      str(c.preview),
      int(c.unread),
      c.lastInboundAt ?? "null",
      c.createdAt,
    ]),
  );
  return (
    section("customers and conversations (FR-010–019, FR-040–049, ADR-016)") +
    insertChunked(
      "public.customers",
      [
        "id",
        "restaurant_id",
        "name",
        "phone",
        "email",
        "cpf_cnpj",
        "cep",
        "logradouro",
        "numero",
        "complemento",
        "bairro",
        "cidade",
        "uf",
        "codigo_municipio",
        "created_at",
      ],
      customers,
    ) +
    "\n" +
    insert(
      "public.conversations",
      [
        "id",
        "restaurant_id",
        "customer_id",
        "external_id",
        "last_message_at",
        "last_message_preview",
        "unread_count",
        "last_inbound_at",
        "created_at",
      ],
      conversations,
    )
  );
}

function ordersSection(models: RestaurantModel[]): string {
  const orders = models.flatMap((m) =>
    m.orders.map((o) => {
      const a = o.customer.spec.address;
      const delivery = o.fulfillment === "delivery";
      return [
        str(o.id),
        str(m.restaurant.id),
        str(o.code),
        str(o.customer.id),
        str(o.status),
        str(o.fulfillment),
        delivery ? str(a.cep) : "null",
        delivery ? str(a.logradouro) : "null",
        delivery ? str(a.numero) : "null",
        delivery ? strOrNull(a.complemento) : "null",
        delivery ? str(a.bairro) : "null",
        delivery ? str(m.restaurant.cidade) : "null",
        delivery ? str(m.restaurant.uf) : "null",
        delivery ? str(m.restaurant.codigoMunicipio) : "null",
        str(o.payment),
        o.changeForCents === null ? "null" : int(o.changeForCents),
        strOrNull(o.notes),
        int(o.subtotalCents),
        int(o.feeCents),
        int(o.subtotalCents + o.feeCents),
        str(o.source),
        o.conversationId === null ? "null" : str(o.conversationId),
        str(o.createdBy),
        o.createdAt,
        o.createdAt,
        o.deliveredAt ?? "null",
        o.cancelledAt ?? "null",
        strOrNull(o.cancelReason),
        o.paidAt ?? "null",
        o.paidAt === null ? "null" : str(o.createdBy),
      ];
    }),
  );
  const items = models.flatMap((m) =>
    m.orders.flatMap((o) =>
      o.items.map((it) => [
        str(it.id),
        str(m.restaurant.id),
        str(o.id),
        it.menuItemId === null ? "null" : str(it.menuItemId),
        str(it.name),
        strOrNull(it.sizeName),
        int(it.unitPriceCents),
        int(it.qty),
        strOrNull(it.notes),
        int(it.position),
      ]),
    ),
  );
  const counters = models.map((m) => [str(m.restaurant.id), int(m.orders.length)]);
  return (
    section(
      "orders (FR-020–039, FR-070–077)",
      "Six months of history plus today's board. The after-insert trigger writes",
      "each order's first order_status_history row; the deferred trigger checks",
      "every subtotal against its items at commit.",
    ) +
    insertChunked(
      "public.orders",
      [
        "id",
        "restaurant_id",
        "code",
        "customer_id",
        "status",
        "fulfillment",
        "cep",
        "logradouro",
        "numero",
        "complemento",
        "bairro",
        "cidade",
        "uf",
        "codigo_municipio",
        "payment_method",
        "change_for_cents",
        "notes",
        "subtotal_cents",
        "delivery_fee_cents",
        "total_cents",
        "source",
        "conversation_id",
        "created_by",
        "created_at",
        "updated_at",
        "delivered_at",
        "cancelled_at",
        "cancel_reason",
        "paid_at",
        "paid_by",
      ],
      orders,
    ) +
    "\n" +
    insertChunked(
      "public.order_items",
      [
        "id",
        "restaurant_id",
        "order_id",
        "menu_item_id",
        "name",
        "size_name",
        "unit_price_cents",
        "qty",
        "notes",
        "position",
      ],
      items,
    ) +
    "\n" +
    insert("public.order_counters", ["restaurant_id", "last_value"], counters)
  );
}

function messagesSection(models: RestaurantModel[]): string {
  let n = 0;
  const rows = models.flatMap((m) => {
    const orderByMock = new Map(m.orders.filter((o) => o.mockId !== null).map((o) => [o.mockId as string, o.id]));
    return m.conversations.flatMap((c) =>
      c.messages.map((msg) => [
        str(msg.id),
        str(m.restaurant.id),
        str(c.id),
        str(msg.direction),
        str(msg.body),
        str(msg.status),
        str(`wamid.seed.${m.restaurant.key}.${++n}`),
        msg.orderMockId === null ? "null" : str(orderByMock.get(msg.orderMockId) ?? ""),
        msg.sentBy === null ? "null" : str(msg.sentBy),
        msg.createdAt,
        msg.createdAt,
      ]),
    );
  });
  return (
    section("messages (FR-013, FR-016)") +
    insert(
      "public.messages",
      [
        "id",
        "restaurant_id",
        "conversation_id",
        "direction",
        "body",
        "status",
        "external_id",
        "order_id",
        "sent_by",
        "created_at",
        "updated_at",
      ],
      rows,
    )
  );
}

function invoicesAndUsage(models: RestaurantModel[]): string {
  const casa = models.find((m) => m.restaurant.key === "casa");
  if (casa === undefined) throw new Error("no casa");
  const delivered = casa.orders.filter((o) => o.status === "entregue" && o.mockId === null).slice(-6);
  const invoices = delivered.map((o, i) => {
    const numero = 101 + i;
    const chave =
      `3525${"11444777000161".padStart(14, "0")}65001${String(numero).padStart(9, "0")}1${String(numero * 7919).padStart(8, "0")}0`
        .slice(0, 44)
        .padEnd(44, "0");
    return [
      str(devUuid(UUID_FAMILY.invoice, i + 1)),
      str(casa.restaurant.id),
      str(o.id),
      str("nfce"),
      str("authorized"),
      str(`nf_seed_${numero}`),
      int(numero),
      "1",
      str(chave),
      jsonb({ fixture: true, order: o.code }),
      str(casa.attendant.id),
      plusMinutes(o.createdAt, 50),
      plusMinutes(o.createdAt, 51),
    ];
  });
  let usageN = 0;
  const usage = models.flatMap((m) =>
    m.orders.map((o) => [
      str(devUuid(UUID_FAMILY.usageEvent, ++usageN)),
      str(m.restaurant.id),
      str("order.created"),
      str(o.id),
      o.createdAt,
    ]),
  );
  for (const m of models) {
    for (const c of m.conversations) {
      for (const msg of c.messages.filter((x) => x.direction === "out")) {
        usage.push([
          str(devUuid(UUID_FAMILY.usageEvent, ++usageN)),
          str(m.restaurant.id),
          str("message.sent"),
          str(msg.id),
          msg.createdAt,
        ]);
      }
    }
  }
  delivered.forEach((o, i) => {
    usage.push([
      str(devUuid(UUID_FAMILY.usageEvent, ++usageN)),
      str(casa.restaurant.id),
      str("invoice.issued"),
      str(devUuid(UUID_FAMILY.invoice, i + 1)),
      plusMinutes(o.createdAt, 51),
    ]);
  });
  let attemptN = 0;
  const attempts = models.flatMap((m) =>
    m.conversations.flatMap((c) =>
      c.messages
        .filter((x) => x.direction === "out")
        .map((msg) => [
          str(devUuid(UUID_FAMILY.jobAttempt, ++attemptN)),
          str(m.restaurant.id),
          str("mt_outbound_messages"),
          str("message"),
          str(msg.id),
          "1",
          str("ok"),
          "201",
          "180",
          msg.createdAt,
        ]),
    ),
  );
  let auditN = 0;
  const audit = (
    m: RestaurantModel,
    action: string,
    entityType: string,
    entityId: string,
    daysAgo: number,
    context: object,
  ) => [
    str(devUuid(UUID_FAMILY.auditLog, ++auditN)),
    str(m.restaurant.id),
    str("user"),
    str(m.admin.id),
    str(action),
    str(entityType),
    str(entityId),
    jsonb(context),
    localDayAt(daysAgo, 10, 0),
  ];
  const minas = models.find((m) => m.restaurant.key === "minas");
  if (minas === undefined) throw new Error("no minas");
  const audits = [
    audit(casa, "integration.whatsapp.configured", "integration", casa.restaurant.id, 45, {
      kind: "uatis_api_key",
      last4: "0001",
    }),
    audit(casa, "integration.fiscal.configured", "integration", casa.restaurant.id, 45, { environment: "homologacao" }),
    audit(casa, "api_key.created", "api_key", API_KEYS[1]?.id ?? "", 40, { environment: "test" }),
    audit(casa, "api_key.revoked", "api_key", API_KEYS[1]?.id ?? "", 21, { environment: "test" }),
    audit(casa, "api_key.created", "api_key", API_KEYS[0]?.id ?? "", 20, { environment: "test" }),
    audit(minas, "integration.whatsapp.configured", "integration", minas.restaurant.id, 30, {
      kind: "uatis_api_key",
      last4: "0006",
    }),
    audit(minas, "api_key.created", "api_key", API_KEYS[2]?.id ?? "", 20, { environment: "test" }),
  ];
  return (
    section("invoices (FR-120–139), usage (FR-150–159), job attempts, audit (NFR-015)") +
    insert(
      "public.order_invoices",
      [
        "id",
        "restaurant_id",
        "order_id",
        "kind",
        "status",
        "external_id",
        "numero",
        "serie",
        "chave_acesso",
        "request_payload",
        "created_by",
        "created_at",
        "updated_at",
      ],
      invoices,
    ) +
    "\n" +
    insertChunked("public.usage_events", ["id", "restaurant_id", "kind", "ref_id", "occurred_at"], usage) +
    "\n" +
    insert(
      "public.job_attempts",
      [
        "id",
        "restaurant_id",
        "queue",
        "subject_type",
        "subject_id",
        "attempt_no",
        "outcome",
        "http_status",
        "duration_ms",
        "created_at",
      ],
      attempts,
    ) +
    "\n" +
    insert(
      "public.audit_logs",
      ["id", "restaurant_id", "actor_type", "actor_id", "action", "entity_type", "entity_id", "context", "created_at"],
      audits,
    )
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function buildModels(): RestaurantModel[] {
  counters.clear();
  return [buildRestaurant(RESTAURANTS.casa, CASA, 7), buildRestaurant(RESTAURANTS.minas, MINAS, 11)];
}

export interface SeedCounts {
  [table: string]: number;
}

/** Row counts per table and restaurant, which verify.ts checks on the live stack. */
export function seedCounts(models = buildModels()): Record<string, SeedCounts> {
  const out: Record<string, SeedCounts> = {};
  for (const m of models) {
    const outbound = m.conversations.flatMap((c) => c.messages).filter((x) => x.direction === "out").length;
    const invoices = m.restaurant.key === "casa" ? 6 : 0;
    out[m.restaurant.id] = {
      restaurant_members: 2,
      business_hours: m.content.hours.length,
      automatic_messages: m.content.automaticMessages.length,
      customers: m.customers.length,
      conversations: m.conversations.length,
      messages: m.conversations.reduce((n, c) => n + c.messages.length, 0),
      menu_items: m.menu.length,
      menu_item_sizes: m.menu.reduce((n, row) => n + row.spec.sizes.length, 0),
      orders: m.orders.length,
      order_items: m.orders.reduce((n, o) => n + o.items.length, 0),
      order_status_history: m.orders.length,
      order_invoices: invoices,
      stock_items: m.stock.length,
      stock_movements: m.movements.length,
      api_keys: API_KEYS.filter((k) => k.restaurant.id === m.restaurant.id).length,
      secrets: SECRET_LIST.filter((s) => s.restaurant.id === m.restaurant.id).length,
      usage_events: m.orders.length + outbound + invoices,
    };
  }
  return out;
}

export function renderSeed(): string {
  const models = buildModels();
  return [
    header(),
    localWiring(),
    authUsers(),
    restaurants(models),
    integrations(),
    catalogue(models),
    people(models),
    ordersSection(models),
    messagesSection(models),
    invoicesAndUsage(models),
    "commit;\n",
  ].join("\n");
}

if (import.meta.main) {
  const sql = renderSeed();
  writeFileSync(OUTPUT, sql, "utf8");
  const counts = seedCounts();
  const summary = Object.entries(counts)
    .map(([id, c]) => `${id.slice(-2)}: orders=${c.orders} customers=${c.customers} messages=${c.messages}`)
    .join("; ");
  console.log(`wrote ${join("supabase", "seed.sql")} (${sql.length} bytes) ${summary}`);
}
