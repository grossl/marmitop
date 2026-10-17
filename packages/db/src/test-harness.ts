// packages/db/src/test-harness.ts
//
// Bootstrap and fixtures for the integration tests (10.testing.md). Not part of
// the package's runtime API; tests import "@mt/db/test-harness".
//
// It owns three things:
//   1. a live, migrated test database (./test-database),
//   2. an owner connection for seeding. The owner bypasses RLS the way a DBA
//      does, so no isolation assertion may run through it directly. Tests reach
//      the production paths with `withRestaurantContext(..., { role: "app_service" })`
//      and `withUserSession(...)` from ./client,
//   3. truncation and fixtures, so each test file starts from a known state.

import { createHash } from "node:crypto";

import { createDb, type Db, type RestaurantContext, type Tx, withRestaurantContext } from "./client";
import { QUEUE_NAMES } from "./queue";
import { ensureTestDatabase } from "./test-database";
import { TENANT_TABLES } from "./types";

let cachedUrl: string | undefined;

export async function testDatabaseUrl(): Promise<string> {
  cachedUrl ??= await ensureTestDatabase();
  return cachedUrl;
}

/** An owner connection for seeding and truncation. */
export async function createTestDb(): Promise<Db> {
  return createDb(await testDatabaseUrl(), { max: 8 });
}

/** Empties every application table and the auth.users stand-in. */
export async function truncateAll(db: Db): Promise<void> {
  const tables = TENANT_TABLES.map((t) => `public.${t}`)
    .concat(["public.rate_counters", "auth.users"])
    .join(", ");
  await db.unsafe(`truncate table ${tables} restart identity cascade`);
}

/** Empties every queue and its archive. */
export async function truncateQueues(db: Db): Promise<void> {
  const tables = QUEUE_NAMES.flatMap((q) => [`pgmq.q_${q}`, `pgmq.a_${q}`]).join(", ");
  await db.unsafe(`truncate table ${tables}`);
}

/** Runs `fn` on the app_service path with `ctx`: the production path for tests. */
export function asService<T>(db: Db, ctx: RestaurantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withRestaurantContext(db, ctx, fn, { role: "app_service" });
}

/** Runs `fn` and returns the Postgres SQLSTATE it raised, or null on success. */
export async function errorCode(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (error: unknown) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : `unknown: ${(error as Error).message}`;
  }
}

/** Row count of a table as the current transaction's policies see it. */
export async function countRows(tx: Tx, table: string): Promise<number> {
  const rows = await tx.unsafe<{ count: number }[]>(`select count(*)::int as count from public.${table}`);
  return rows[0]?.count ?? 0;
}

export const INSUFFICIENT_PRIVILEGE = "42501";
export const CHECK_VIOLATION = "23514";
export const RAISE_EXCEPTION = "P0001";

let userCounter = 0;

/** Creates an auth.users stand-in row and returns its id. */
/**
 * Per-process id mixed into values that are unique across the whole table
 * (auth email, API key hash). Counters restart in every process, so without it
 * a second run collides with rows an earlier run left in `mt_test`.
 */
const RUN_ID = crypto.randomUUID().slice(0, 8);

export async function createUser(db: Db, label: string): Promise<string> {
  userCounter += 1;
  const [row] = await db<{ id: string }[]>`
    insert into auth.users (email) values (${`${label}-${RUN_ID}-${userCounter}@example.test`}) returning id
  `;
  if (row === undefined) throw new Error("failed to create auth.users row");
  return row.id;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// ---------------------------------------------------------------------------
// Fixture: one row in every tenant table
// ---------------------------------------------------------------------------

export interface RestaurantFixture {
  restaurantId: string;
  adminId: string;
  attendantId: string;
  adminMemberId: string;
  attendantMemberId: string;
  apiKeyId: string;
  revokedApiKeyId: string;
  apiKeyHash: string;
  secretIds: Record<"uatisKey" | "uatisWebhook" | "webnfKey" | "webnfWebhook" | "outbound", string>;
  businessHoursId: string;
  automaticMessageId: string;
  customerId: string;
  conversationId: string;
  messageId: string;
  menuItemId: string;
  menuItemSizeId: string;
  orderId: string;
  orderItemId: string;
  orderStatusHistoryId: string;
  orderInvoiceId: string;
  stockItemId: string;
  stockMovementId: string;
  webhookEndpointId: string;
  webhookDeliveryId: string;
  idempotencyKey: string;
  jobAttemptId: string;
  /** `uatis_event_receipts.event_id` (migration 0019). */
  uatisEventId: string;
  auditLogId: string;
  usageEventId: string;
  /** `ai_settings` is keyed by `restaurant_id`; the fixture row has the assistant off. */
  aiRunId: string;
  /** A placed cart (not open), so a test may open a new cart on `conversationId`. */
  aiCartId: string;
  adminCtx: RestaurantContext;
  attendantCtx: RestaurantContext;
  apiKeyCtx: RestaurantContext;
  systemCtx: RestaurantContext;
}

let fixtureCounter = 0;

async function one<T>(rows: Promise<T[]>, what: string): Promise<T> {
  const row = (await rows)[0];
  if (row === undefined) throw new Error(`fixture: no row returned for ${what}`);
  return row;
}

/**
 * Seeds one restaurant with an admin, an attendant, an API key, and at least
 * one row in every tenant table, on the owner connection, in one transaction
 * (the subtotal check is deferred to commit).
 */
export async function seedRestaurant(db: Db, label: string): Promise<RestaurantFixture> {
  fixtureCounter += 1;
  const n = fixtureCounter;
  const adminId = await createUser(db, `${label}-admin`);
  const attendantId = await createUser(db, `${label}-attendant`);
  const apiKeyHash = sha256Hex(`mtk_test_${label}_${RUN_ID}_${n}`);
  const revokedHash = sha256Hex(`mtk_test_${label}_${RUN_ID}_${n}_revoked`);

  return db.begin(async (sql) => {
    const tx = sql as unknown as Tx;
    const r = await one(
      tx<{ id: string }[]>`
        insert into public.restaurants (name, cidade, uf, codigo_municipio)
        values (${label}, 'São Paulo', 'SP', '3550308') returning id`,
      "restaurants",
    );
    const rid = r.id;
    const admin = await one(
      tx<{ id: string }[]>`
        insert into public.restaurant_members (restaurant_id, user_id, role) values (${rid}, ${adminId}, 'admin') returning id`,
      "admin member",
    );
    const attendant = await one(
      tx<{ id: string }[]>`
        insert into public.restaurant_members (restaurant_id, user_id, role) values (${rid}, ${attendantId}, 'attendant') returning id`,
      "attendant member",
    );
    await tx`insert into public.restaurant_settings (restaurant_id) values (${rid})`;
    const hours = await one(
      tx<{ id: string }[]>`
        insert into public.business_hours (restaurant_id, weekday, opens_at, closes_at)
        values (${rid}, 1, '08:00', '18:00') returning id`,
      "business_hours",
    );
    const auto = await one(
      tx<{ id: string }[]>`
        insert into public.automatic_messages (restaurant_id, kind, body)
        values (${rid}, 'welcome', 'Olá!') returning id`,
      "automatic_messages",
    );

    const secretIds = {} as RestaurantFixture["secretIds"];
    const kinds = [
      ["uatisKey", "uatis_api_key"],
      ["uatisWebhook", "uatis_webhook_secret"],
      ["webnfKey", "webnf_api_key"],
      ["webnfWebhook", "webnf_webhook_secret"],
      ["outbound", "outbound_webhook_secret"],
    ] as const;
    for (const [key, kind] of kinds) {
      const s = await one(
        tx<{ id: string }[]>`
          insert into public.secrets (restaurant_id, kind, ciphertext, iv, wrapped_key, last4)
          values (${rid}, ${kind}, '\\x01'::bytea, '\\x000102030405060708090a0b'::bytea, '\\x02'::bytea, 'abcd')
          returning id`,
        `secret ${kind}`,
      );
      secretIds[key] = s.id;
    }

    await tx`
      insert into public.integrations_whatsapp (restaurant_id, base_url, api_key_secret_id, webhook_secret_id, phone_number_id, status)
      values (${rid}, 'http://localhost:4010', ${secretIds.uatisKey}, ${secretIds.uatisWebhook}, ${`pn-${n}`}, 'connected')`;
    await tx`
      insert into public.integrations_fiscal
        (restaurant_id, base_url, api_key_secret_id, webhook_secret_id, default_ncm, default_cfop, default_pis_cst, default_cofins_cst)
      values (${rid}, 'http://localhost:4020', ${secretIds.webnfKey}, ${secretIds.webnfWebhook}, '21069090', '5102', '49', '49')`;

    const apiKey = await one(
      tx<{ id: string }[]>`
        insert into public.api_keys (restaurant_id, name, prefix, hash, environment, created_by)
        values (${rid}, 'integração', 'mtk_test_abc', ${apiKeyHash}, 'test', ${adminId}) returning id`,
      "api_keys",
    );
    const revoked = await one(
      tx<{ id: string }[]>`
        insert into public.api_keys (restaurant_id, name, prefix, hash, environment, revoked_at)
        values (${rid}, 'revogada', 'mtk_test_old', ${revokedHash}, 'test', now()) returning id`,
      "revoked api key",
    );

    const customer = await one(
      tx<{ id: string }[]>`
        insert into public.customers (restaurant_id, name, phone, logradouro, numero, bairro, cidade, uf)
        values (${rid}, 'Maria', ${`+55119876543${String(n).padStart(2, "0")}`}, 'Rua das Flores', '342', 'Vila Madalena', 'São Paulo', 'SP')
        returning id`,
      "customers",
    );
    const conversation = await one(
      tx<{ id: string }[]>`
        insert into public.conversations (restaurant_id, customer_id, last_message_at, last_message_preview, unread_count)
        values (${rid}, ${customer.id}, now(), 'Oi', 1) returning id`,
      "conversations",
    );
    const menuItem = await one(
      tx<{ id: string }[]>`
        insert into public.menu_items (restaurant_id, kind, name, category, price_cents, calories)
        values (${rid}, 'meal', 'Frango Grelhado', 'proteinas', 1890, 520) returning id`,
      "menu_items",
    );
    const size = await one(
      tx<{ id: string }[]>`
        insert into public.menu_item_sizes (restaurant_id, menu_item_id, name, price_cents)
        values (${rid}, ${menuItem.id}, 'M', 1890) returning id`,
      "menu_item_sizes",
    );
    await tx`insert into public.order_counters (restaurant_id, last_value) values (${rid}, 1)`;
    const order = await one(
      tx<{ id: string }[]>`
        insert into public.orders
          (restaurant_id, code, customer_id, status, fulfillment, logradouro, numero, bairro,
           payment_method, subtotal_cents, delivery_fee_cents, total_cents, source, conversation_id, created_by)
        values (${rid}, 'ORD-001', ${customer.id}, 'aguardando', 'delivery', 'Rua das Flores', '342', 'Vila Madalena',
           'pix', 3780, 500, 4280, 'whatsapp', ${conversation.id}, ${attendantId})
        returning id`,
      "orders",
    );
    const item = await one(
      tx<{ id: string }[]>`
        insert into public.order_items (restaurant_id, order_id, menu_item_id, name, size_name, unit_price_cents, qty)
        values (${rid}, ${order.id}, ${menuItem.id}, 'Frango Grelhado', 'M', 1890, 2) returning id`,
      "order_items",
    );
    const history = await one(
      tx<{ id: string }[]>`
        insert into public.order_status_history (restaurant_id, order_id, from_status, to_status, actor_type)
        values (${rid}, ${order.id}, null, 'aguardando', 'system') returning id`,
      "order_status_history",
    );
    const message = await one(
      tx<{ id: string }[]>`
        insert into public.messages (restaurant_id, conversation_id, direction, body, status, order_id, external_id)
        values (${rid}, ${conversation.id}, 'in', 'Quero 2 marmitas', 'delivered', ${order.id}, ${`ext-${n}`})
        returning id`,
      "messages",
    );
    const invoice = await one(
      tx<{ id: string }[]>`
        insert into public.order_invoices (restaurant_id, order_id, kind, status, created_by)
        values (${rid}, ${order.id}, 'nfce', 'queued', ${attendantId}) returning id`,
      "order_invoices",
    );
    const stockItem = await one(
      tx<{ id: string }[]>`
        insert into public.stock_items (restaurant_id, name, unit, category, current_qty, minimum_qty, unit_cost_cents)
        values (${rid}, 'Arroz', 'kg', 'insumos', 0, 10, 650) returning id`,
      "stock_items",
    );
    const movement = await one(
      tx<{ id: string }[]>`
        insert into public.stock_movements (restaurant_id, stock_item_id, kind, qty, balance_after, reason)
        values (${rid}, ${stockItem.id}, 'in', 18, 18, 'compra') returning id`,
      "stock_movements",
    );
    const endpoint = await one(
      tx<{ id: string }[]>`
        insert into public.webhook_endpoints (restaurant_id, url, secret_id, events)
        values (${rid}, 'https://example.test/hook', ${secretIds.outbound}, array['order.created']) returning id`,
      "webhook_endpoints",
    );
    const delivery = await one(
      tx<{ id: string }[]>`
        insert into public.webhook_deliveries (restaurant_id, endpoint_id, event, payload)
        values (${rid}, ${endpoint.id}, 'order.created', ${tx.json({ orderId: order.id })}) returning id`,
      "webhook_deliveries",
    );
    const idempotencyKey = `idem-${n}`;
    await tx`
      insert into public.idempotency_records (restaurant_id, idempotency_key, request_hash, response_status, response_body)
      values (${rid}, ${idempotencyKey}, 'h', 201, ${tx.json({ ok: true })})`;
    const attempt = await one(
      tx<{ id: string }[]>`
        insert into public.job_attempts (restaurant_id, queue, subject_type, subject_id, attempt_no, outcome)
        values (${rid}, 'mt_outbound_messages', 'message', ${message.id}, 1, 'ok') returning id`,
      "job_attempts",
    );
    const uatisEventId = crypto.randomUUID();
    await tx`
      insert into public.uatis_event_receipts (restaurant_id, event_id, event_type, source)
      values (${rid}, ${uatisEventId}, 'message.created', 'push')`;
    const audit = await one(
      tx<{ id: string }[]>`
        insert into public.audit_logs (restaurant_id, actor_type, actor_id, action, entity_type, entity_id)
        values (${rid}, 'user', ${adminId}, 'api_key.created', 'api_key', ${apiKey.id}) returning id`,
      "audit_logs",
    );
    const usage = await one(
      tx<{ id: string }[]>`
        insert into public.usage_events (restaurant_id, kind, ref_id) values (${rid}, 'order.created', ${order.id}) returning id`,
      "usage_events",
    );

    await tx`insert into public.ai_settings (restaurant_id) values (${rid})`;
    const aiRun = await one(
      tx<{ id: string }[]>`
        insert into public.ai_runs (restaurant_id, conversation_id, trigger_message_id, status, model_calls)
        values (${rid}, ${conversation.id}, ${message.id}, 'replied', 1) returning id`,
      "ai_runs",
    );
    const aiCart = await one(
      tx<{ id: string }[]>`
        insert into public.ai_carts (restaurant_id, conversation_id, status, fulfillment, order_id)
        values (${rid}, ${conversation.id}, 'placed', 'delivery', ${order.id}) returning id`,
      "ai_carts",
    );

    return {
      restaurantId: rid,
      adminId,
      attendantId,
      adminMemberId: admin.id,
      attendantMemberId: attendant.id,
      apiKeyId: apiKey.id,
      revokedApiKeyId: revoked.id,
      apiKeyHash,
      secretIds,
      businessHoursId: hours.id,
      automaticMessageId: auto.id,
      customerId: customer.id,
      conversationId: conversation.id,
      messageId: message.id,
      menuItemId: menuItem.id,
      menuItemSizeId: size.id,
      orderId: order.id,
      orderItemId: item.id,
      orderStatusHistoryId: history.id,
      orderInvoiceId: invoice.id,
      stockItemId: stockItem.id,
      stockMovementId: movement.id,
      webhookEndpointId: endpoint.id,
      webhookDeliveryId: delivery.id,
      idempotencyKey,
      jobAttemptId: attempt.id,
      uatisEventId,
      auditLogId: audit.id,
      usageEventId: usage.id,
      aiRunId: aiRun.id,
      aiCartId: aiCart.id,
      adminCtx: { restaurantId: rid, actorType: "user", userId: adminId },
      attendantCtx: { restaurantId: rid, actorType: "user", userId: attendantId },
      apiKeyCtx: { restaurantId: rid, actorType: "api_key", apiKeyId: apiKey.id },
      systemCtx: { restaurantId: rid, actorType: "system" },
    };
  }) as Promise<RestaurantFixture>;
}
