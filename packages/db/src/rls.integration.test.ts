// packages/db/src/rls.integration.test.ts
//
// covers NFR-001, NFR-002, NFR-003, NFR-052, FR-004, FR-006, FR-008, FR-049, FR-195
//
// Tenant isolation and the role rules, proven against the real migrations
// (05.data-model.md "Access model" and "Role rules", 07.security.md, ADR-005,
// ADR-017). Two restaurants, A and B, each with one row in every tenant table.
// Every probe runs inside a transaction that is rolled back, so probes never
// change the fixtures.
//
// Paths walked:
//   * service path: role app_service + mt.set_context, as admin, attendant,
//     API key, revoked API key, system, and a user with no membership;
//   * service path with no context (fail closed);
//   * user path: role authenticated + auth.uid() (the browser).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { type Db, type RestaurantContext, type Tx, withoutContext, withUserSession } from "./client";
import {
  asService,
  createTestDb,
  createUser,
  errorCode,
  INSUFFICIENT_PRIVILEGE,
  type RestaurantFixture,
  seedRestaurant,
  truncateAll,
} from "./test-harness";
import { GLOBAL_TABLES, REALTIME_COLUMN_GRANTS, REALTIME_TABLES, TENANT_TABLES, type TenantTable } from "./types";

type ReadRole = "member" | "admin" | null;
type WriteRole = "attendant" | "admin" | null;

interface TableSpec {
  table: TenantTable;
  tenantColumn: string;
  pkColumn: string;
  pk: (f: RestaurantFixture) => string;
  select: ReadRole;
  insert: WriteRole;
  update: WriteRole;
  delete: WriteRole;
  /** A SET clause the role's update grant covers. */
  updateSet: string;
  /** The row a delete probe targets (defaults to `pk`). */
  deletePk?: (f: RestaurantFixture) => string;
  /** Inserts one row for restaurant `f`, with references inside `f`. */
  insertRow: (tx: Tx, f: RestaurantFixture) => Promise<unknown>;
}

const rand = () => Math.random().toString(36).slice(2, 10);
const randHex = () => Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

let outsiderId = "";

// The 05.data-model.md "Role rules" table, row by row.
const SPECS: TableSpec[] = [
  {
    table: "restaurants",
    tenantColumn: "id",
    pkColumn: "id",
    pk: (f) => f.restaurantId,
    select: "member",
    insert: null,
    update: "admin",
    delete: null,
    updateSet: "name = 'crossed'",
    insertRow: (tx) => tx`insert into public.restaurants (name) values ('intruder')`,
  },
  {
    table: "restaurant_members",
    tenantColumn: "restaurant_id",
    pkColumn: "id",
    pk: (f) => f.attendantMemberId,
    select: "member",
    insert: "admin",
    update: "admin",
    delete: "admin",
    updateSet: "role = 'admin'",
    insertRow: (tx, f) =>
      tx`insert into public.restaurant_members (restaurant_id, user_id, role) values (${f.restaurantId}, ${outsiderId}, 'admin')`,
  },
  {
    table: "restaurant_settings",
    tenantColumn: "restaurant_id",
    pkColumn: "restaurant_id",
    pk: (f) => f.restaurantId,
    select: "member",
    insert: "admin",
    update: "admin",
    delete: "admin",
    updateSet: "auto_accept = true",
    insertRow: (tx, f) => tx`insert into public.restaurant_settings (restaurant_id) values (${f.restaurantId})`,
  },
  {
    table: "business_hours",
    tenantColumn: "restaurant_id",
    pkColumn: "id",
    pk: (f) => f.businessHoursId,
    select: "member",
    insert: "admin",
    update: "admin",
    delete: "admin",
    updateSet: "enabled = false",
    insertRow: (tx, f) =>
      tx`insert into public.business_hours (restaurant_id, weekday, opens_at, closes_at) values (${f.restaurantId}, 3, '09:00', '15:00')`,
  },
  {
    table: "automatic_messages",
    tenantColumn: "restaurant_id",
    pkColumn: "id",
    pk: (f) => f.automaticMessageId,
    select: "member",
    insert: "admin",
    update: "admin",
    delete: "admin",
    updateSet: "body = 'crossed'",
    insertRow: (tx, f) =>
      tx`insert into public.automatic_messages (restaurant_id, kind, body) values (${f.restaurantId}, 'closed', 'Fechado')`,
  },
  {
    table: "secrets",
    tenantColumn: "restaurant_id",
    pkColumn: "id",
    pk: (f) => f.secretIds.outbound,
    select: "admin",
    insert: "admin",
    update: null,
    delete: "admin",
    updateSet: "last4 = 'zzzz'",
    insertRow: (tx, f) => tx`
      insert into public.secrets (restaurant_id, kind, ciphertext, iv, wrapped_key, last4)
      values (${f.restaurantId}, 'uatis_api_key', '\\x01'::bytea, '\\x000102030405060708090a0b'::bytea, '\\x02'::bytea, 'wxyz')`,
  },
  {
    table: "integrations_whatsapp",
    tenantColumn: "restaurant_id",
    pkColumn: "restaurant_id",
    pk: (f) => f.restaurantId,
    select: "admin",
    insert: "admin",
    update: "admin",
    delete: "admin",
    updateSet: "last_error = 'crossed'",
    insertRow: (tx, f) => tx`
      insert into public.integrations_whatsapp (restaurant_id, base_url, api_key_secret_id, webhook_secret_id, phone_number_id)
      values (${f.restaurantId}, 'http://localhost:1', ${f.secretIds.uatisKey}, ${f.secretIds.uatisWebhook}, 'x')`,
  },
  {
    table: "integrations_fiscal",
    tenantColumn: "restaurant_id",
    pkColumn: "restaurant_id",
    pk: (f) => f.restaurantId,
    select: "member",
    insert: "admin",
    update: "admin",
    delete: "admin",
    updateSet: "last_error = 'crossed'",
    insertRow: (tx, f) => tx`
      insert into public.integrations_fiscal
        (restaurant_id, base_url, api_key_secret_id, webhook_secret_id, default_ncm, default_cfop, default_pis_cst, default_cofins_cst)
      values (${f.restaurantId}, 'http://localhost:1', ${f.secretIds.webnfKey}, ${f.secretIds.webnfWebhook}, '21069090', '5102', '49', '49')`,
  },
  {
    table: "api_keys",
    tenantColumn: "restaurant_id",
    pkColumn: "id",
    pk: (f) => f.revokedApiKeyId,
    select: "admin",
    insert: "admin",
    update: "admin",
    delete: "admin",
    updateSet: "name = 'crossed'",
    insertRow: (tx, f) => tx`
      insert into public.api_keys (restaurant_id, name, prefix, hash, environment)
      values (${f.restaurantId}, 'x', 'mtk_test_x', ${randHex()}, 'test')`,
  },
  {
    table: "customers",
    tenantColumn: "restaurant_id",
    pkColumn: "id",
    pk: (f) => f.customerId,
    select: "member",
    insert: "attendant",
    update: "attendant",
    delete: null,
    updateSet: "notes = 'crossed'",
    insertRow: (tx, f) => tx`
      insert into public.customers (restaurant_id, name, phone)
      values (${f.restaurantId}, 'Novo', ${`+55219${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`})`,
  },
  {
    table: "conversations",
    tenantColumn: "restaurant_id",
    pkColumn: "id",
    pk: (f) => f.conversationId,
    select: "member",
    insert: "attendant",
    update: "attendant",
    delete: null,
    updateSet: "unread_count = 0",
    insertRow: (tx, f) =>
      tx`insert into public.conversations (restaurant_id, customer_id) values (${f.restaurantId}, ${f.customerId})`,
  },
  {
    table: "messages",
    tenantColumn: "restaurant_id",
    pkColumn: "id",
    pk: (f) => f.messageId,
    select: "member",
    insert: "attendant",
    update: "attendant",
    delete: null,
    updateSet: "status = 'read'",
    insertRow: (tx, f) => tx`
      insert into public.messages (restaurant_id, conversation_id, direction, body, status)
      values (${f.restaurantId}, ${f.conversationId}, 'out', 'Olá', 'pending')`,
  },
  {
    table: "menu_items",
    tenantColumn: "restaurant_id",
    pkColumn: "id",
    pk: (f) => f.menuItemId,
    select: "member",
    insert: "admin",
    update: "admin",
    delete: null,
    updateSet: "available = false",
    insertRow: (tx, f) => tx`
      insert into public.menu_items (restaurant_id, kind, name, category, price_cents, volume)
      values (${f.restaurantId}, 'drink', 'Suco', 'sucos', 800, '300ml')`,
  },
  {
    table: "menu_item_sizes",
    tenantColumn: "restaurant_id",
    pkColumn: "id",
    pk: (f) => f.menuItemSizeId,
    select: "member",
    insert: "admin",
    update: "admin",
    delete: "admin",
    updateSet: "price_cents = 1",
    insertRow: (tx, f) => tx`
      insert into public.menu_item_sizes (restaurant_id, menu_item_id, name, price_cents)
      values (${f.restaurantId}, ${f.menuItemId}, ${`S-${rand()}`}, 100)`,
  },
  {
    table: "order_counters",
    tenantColumn: "restaurant_id",
    pkColumn: "restaurant_id",
    pk: (f) => f.restaurantId,
    select: null,
    insert: null,
    update: null,
    delete: null,
    updateSet: "last_value = 999",
    insertRow: (tx, f) =>
      tx`insert into public.order_counters (restaurant_id, last_value) values (${f.restaurantId}, 5)`,
  },
  {
    table: "orders",
    tenantColumn: "restaurant_id",
    pkColumn: "id",
    pk: (f) => f.orderId,
    select: "member",
    insert: "attendant",
    update: "attendant",
    delete: null,
    updateSet: "notes = 'crossed'",
    insertRow: (tx, f) => tx`
      insert into public.orders
        (restaurant_id, code, customer_id, status, fulfillment, payment_method, subtotal_cents, total_cents, source)
      values (${f.restaurantId}, ${`ORD-9${Math.floor(Math.random() * 1e6)}`}, ${f.customerId}, 'aguardando', 'pickup', 'pix', 0, 0, 'counter')`,
  },
  {
    table: "order_items",
    tenantColumn: "restaurant_id",
    pkColumn: "id",
    pk: (f) => f.orderItemId,
    select: "member",
    insert: "attendant",
    update: "attendant",
    delete: null,
    updateSet: "notes = 'crossed'",
    insertRow: (tx, f) => tx`
      insert into public.order_items (restaurant_id, order_id, name, unit_price_cents, qty)
      values (${f.restaurantId}, ${f.orderId}, 'Extra', 100, 1)`,
  },
  {
    table: "order_status_history",
    tenantColumn: "restaurant_id",
    pkColumn: "id",
    pk: (f) => f.orderStatusHistoryId,
    select: "member",
    insert: "attendant",
    update: null,
    delete: null,
    updateSet: "to_status = 'finalizado'",
    insertRow: (tx, f) => tx`
      insert into public.order_status_history (restaurant_id, order_id, from_status, to_status, actor_type)
      values (${f.restaurantId}, ${f.orderId}, 'aguardando', 'confirmado', 'user')`,
  },
  {
    table: "order_invoices",
    tenantColumn: "restaurant_id",
    pkColumn: "id",
    pk: (f) => f.orderInvoiceId,
    select: "member",
    insert: "attendant",
    update: "attendant",
    delete: null,
    updateSet: "error_code = 'crossed'",
    insertRow: (tx, f) => tx`
      insert into public.order_invoices (restaurant_id, order_id, kind, status)
      values (${f.restaurantId}, ${f.orderId}, 'nfce', 'rejected')`,
  },
  {
    table: "stock_items",
    tenantColumn: "restaurant_id",
    pkColumn: "id",
    pk: (f) => f.stockItemId,
    select: "member",
    insert: "admin",
    update: "admin",
    delete: null,
    updateSet: "name = 'crossed'",
    insertRow: (tx, f) =>
      tx`insert into public.stock_items (restaurant_id, name, unit, category) values (${f.restaurantId}, 'Feijão', 'kg', 'insumos')`,
  },
  {
    table: "stock_movements",
    tenantColumn: "restaurant_id",
    pkColumn: "id",
    pk: (f) => f.stockMovementId,
    select: "member",
    insert: "admin",
    update: null,
    delete: null,
    updateSet: "reason = 'crossed'",
    insertRow: (tx, f) => tx`
      insert into public.stock_movements (restaurant_id, stock_item_id, kind, qty, balance_after)
      values (${f.restaurantId}, ${f.stockItemId}, 'in', 1, 0)`,
  },
  {
    table: "webhook_endpoints",
    tenantColumn: "restaurant_id",
    pkColumn: "id",
    pk: (f) => f.webhookEndpointId,
    select: "member",
    insert: "admin",
    update: "admin",
    delete: "admin",
    updateSet: "enabled = false",
    insertRow: (tx, f) => tx`
      insert into public.webhook_endpoints (restaurant_id, url, secret_id, events)
      values (${f.restaurantId}, 'https://example.test/x', ${f.secretIds.outbound}, array['order.created'])`,
  },
  {
    table: "webhook_deliveries",
    tenantColumn: "restaurant_id",
    pkColumn: "id",
    pk: (f) => f.webhookDeliveryId,
    select: "admin",
    insert: "attendant",
    update: "admin",
    delete: "admin",
    updateSet: "attempts = 3",
    insertRow: (tx, f) => tx`
      insert into public.webhook_deliveries (restaurant_id, endpoint_id, event, payload)
      values (${f.restaurantId}, ${f.webhookEndpointId}, 'order.created', '{}'::jsonb)`,
  },
  {
    table: "idempotency_records",
    tenantColumn: "restaurant_id",
    pkColumn: "idempotency_key",
    pk: (f) => f.idempotencyKey,
    select: "member",
    insert: "attendant",
    update: "attendant",
    delete: "attendant",
    updateSet: "response_status = 500",
    insertRow: (tx, f) => tx`
      insert into public.idempotency_records (restaurant_id, idempotency_key, request_hash, response_status, response_body)
      values (${f.restaurantId}, ${`k-${rand()}`}, 'h', 201, '{}'::jsonb)`,
  },
  {
    table: "job_attempts",
    tenantColumn: "restaurant_id",
    pkColumn: "id",
    pk: (f) => f.jobAttemptId,
    select: "admin",
    insert: "admin",
    update: null,
    delete: null,
    updateSet: "attempt_no = 9",
    insertRow: (tx, f) => tx`
      insert into public.job_attempts (restaurant_id, queue, subject_type, attempt_no, outcome)
      values (${f.restaurantId}, 'mt_sync', 'sync', 1, 'ok')`,
  },
  {
    table: "uatis_event_receipts",
    tenantColumn: "restaurant_id",
    pkColumn: "event_id",
    pk: (f) => f.uatisEventId,
    select: "admin",
    insert: "admin",
    update: null,
    delete: "admin",
    updateSet: "source = 'pull'",
    insertRow: (tx, f) => tx`
      insert into public.uatis_event_receipts (restaurant_id, event_id, event_type, source)
      values (${f.restaurantId}, ${crypto.randomUUID()}, 'message.created', 'pull')`,
  },
  {
    table: "audit_logs",
    tenantColumn: "restaurant_id",
    pkColumn: "id",
    pk: (f) => f.auditLogId,
    select: "admin",
    insert: "attendant",
    update: null,
    delete: null,
    updateSet: "action = 'crossed'",
    insertRow: (tx, f) => tx`
      insert into public.audit_logs (restaurant_id, actor_type, action, entity_type)
      values (${f.restaurantId}, 'system', 'test.probe', 'probe')`,
  },
  {
    table: "ai_settings",
    tenantColumn: "restaurant_id",
    pkColumn: "restaurant_id",
    pk: (f) => f.restaurantId,
    select: "member",
    insert: "admin",
    update: "admin",
    delete: null,
    updateSet: "enabled = true",
    insertRow: (tx, f) => tx`insert into public.ai_settings (restaurant_id) values (${f.restaurantId})`,
  },
  {
    table: "ai_runs",
    tenantColumn: "restaurant_id",
    pkColumn: "id",
    pk: (f) => f.aiRunId,
    select: "member",
    insert: "admin",
    update: "admin",
    delete: null,
    updateSet: "status = 'failed'",
    insertRow: (tx, f) => tx`
      insert into public.ai_runs (restaurant_id, conversation_id, trigger_message_id, status)
      values (${f.restaurantId}, ${f.conversationId}, ${f.messageId}, 'running')`,
  },
  {
    table: "ai_carts",
    tenantColumn: "restaurant_id",
    pkColumn: "id",
    pk: (f) => f.aiCartId,
    select: "member",
    insert: "admin",
    update: "admin",
    delete: null,
    updateSet: "status = 'abandoned'",
    insertRow: (tx, f) => tx`
      insert into public.ai_carts (restaurant_id, conversation_id, status)
      values (${f.restaurantId}, ${f.conversationId}, 'abandoned')`,
  },
  {
    table: "menu_order_drafts",
    tenantColumn: "restaurant_id",
    pkColumn: "id",
    pk: (f) => f.menuOrderDraftId,
    select: "member",
    insert: "admin",
    update: "admin",
    delete: null,
    updateSet: "expires_at = now()",
    insertRow: (tx, f) => tx`
      insert into public.menu_order_drafts (restaurant_id, reference, payload)
      values (${f.restaurantId}, translate(upper(substr(md5(random()::text), 1, 8)), '01', '23'), '{}'::jsonb)`,
  },
  {
    table: "print_jobs",
    tenantColumn: "restaurant_id",
    pkColumn: "id",
    pk: (f) => f.printJobId,
    select: "member",
    insert: "attendant",
    update: "attendant",
    delete: null,
    updateSet: "attempts = attempts + 1",
    // The fixture order already has its job: an allowed insert passes RLS, then hits the unique key.
    insertRow: (tx, f) => tx`
      insert into public.print_jobs (restaurant_id, order_id) values (${f.restaurantId}, ${f.orderId})`,
  },
  {
    table: "usage_events",
    tenantColumn: "restaurant_id",
    pkColumn: "id",
    pk: (f) => f.usageEventId,
    select: "admin",
    insert: "attendant",
    update: null,
    delete: null,
    updateSet: "kind = 'message.sent'",
    insertRow: (tx, f) =>
      tx`insert into public.usage_events (restaurant_id, kind, ref_id) values (${f.restaurantId}, 'message.sent', gen_random_uuid())`,
  },
];

// ---------------------------------------------------------------------------
// Probe helpers. Each probe runs in its own transaction and always rolls back.
// ---------------------------------------------------------------------------

class Rollback extends Error {
  constructor(readonly value: unknown) {
    super("rollback");
  }
}

let db: Db;
let a: RestaurantFixture;
let b: RestaurantFixture;

type Outcome = "allowed" | "denied";

/** Runs `fn` on the service path as `ctx`, then rolls back. */
async function probe(ctx: RestaurantContext | null, fn: (tx: Tx) => Promise<{ count: number }>): Promise<Outcome> {
  let count = -1;
  const code = await errorCode(async () => {
    try {
      const run = async (tx: Tx) => {
        const result = await fn(tx);
        throw new Rollback(result.count);
      };
      if (ctx === null) await withoutContext(db, run);
      else await asService(db, ctx, run);
    } catch (error) {
      if (error instanceof Rollback) {
        count = error.value as number;
        return;
      }
      throw error;
    }
  });
  if (code === INSUFFICIENT_PRIVILEGE) return "denied";
  if (code !== null) return "allowed"; // passed RLS, then hit a constraint
  return count > 0 ? "allowed" : "denied";
}

function selectOwn(spec: TableSpec, f: RestaurantFixture) {
  return async (tx: Tx) => {
    const rows = await tx.unsafe<{ count: number }[]>(
      `select count(*)::int as count from public.${spec.table} where ${spec.tenantColumn} = $1`,
      [f.restaurantId],
    );
    return { count: rows[0]?.count ?? 0 };
  };
}

function updateRow(spec: TableSpec, f: RestaurantFixture) {
  return async (tx: Tx) => {
    const result = await tx.unsafe(`update public.${spec.table} set ${spec.updateSet} where ${spec.pkColumn} = $1`, [
      spec.pk(f),
    ]);
    return { count: result.count };
  };
}

function deleteRow(spec: TableSpec, f: RestaurantFixture) {
  return async (tx: Tx) => {
    const result = await tx.unsafe(`delete from public.${spec.table} where ${spec.pkColumn} = $1`, [
      (spec.deletePk ?? spec.pk)(f),
    ]);
    return { count: result.count };
  };
}

function insertRow(spec: TableSpec, f: RestaurantFixture) {
  return async (tx: Tx) => {
    await spec.insertRow(tx, f);
    return { count: 1 };
  };
}

const ROLE_RANK = { attendant: 1, admin: 2 } as const;

function expected(required: ReadRole | WriteRole, actor: "admin" | "attendant" | null): Outcome {
  if (required === null || actor === null) return "denied";
  if (required === "member") return "allowed";
  return ROLE_RANK[actor] >= ROLE_RANK[required] ? "allowed" : "denied";
}

beforeAll(async () => {
  db = await createTestDb();
  await truncateAll(db);
  a = await seedRestaurant(db, "Restaurante A");
  b = await seedRestaurant(db, "Restaurante B");
  outsiderId = await createUser(db, "outsider");
});

afterAll(async () => {
  await db?.end({ timeout: 5 });
});

// ---------------------------------------------------------------------------
// Meta-tests: a new table cannot ship unprotected
// ---------------------------------------------------------------------------

describe("meta: every table is protected", () => {
  const LEDGERS = ["_mt_test_migrations", "schema_migrations"];

  test("every public table has RLS enabled and forced", async () => {
    const rows = await db<{ relname: string; enabled: boolean; forced: boolean }[]>`
      select c.relname, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> all(${LEDGERS})
      order by c.relname
    `;
    expect(rows.length).toBeGreaterThan(0);
    const unprotected = rows.filter((r) => !r.enabled || !r.forced).map((r) => r.relname);
    expect(unprotected).toEqual([]);
  });

  test("every table with a tenant key is listed in TENANT_TABLES and has an isolation spec", async () => {
    const rows = await db<{ table_name: string }[]>`
      select distinct table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'restaurant_id'
      order by table_name
    `;
    const fromDb = new Set(rows.map((r) => r.table_name).concat(["restaurants"]));
    const listed = new Set<string>(TENANT_TABLES);
    const specced = new Set<string>(SPECS.map((s) => s.table));
    expect([...fromDb].filter((t) => !listed.has(t))).toEqual([]);
    expect([...listed].filter((t) => !fromDb.has(t))).toEqual([]);
    expect([...listed].filter((t) => !specced.has(t))).toEqual([]);
  });

  test("the only tables without a tenant key are the global ones", async () => {
    const rows = await db<{ relname: string }[]>`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> all(${LEDGERS})
    `;
    const tenant = new Set<string>(TENANT_TABLES);
    const others = rows
      .map((r) => r.relname)
      .filter((t) => !tenant.has(t))
      .sort();
    expect(others).toEqual([...GLOBAL_TABLES].sort());
  });

  test("authenticated and anon hold no write grant on any table or column (ADR-017)", async () => {
    const tableGrants = await db<{ grantee: string; table_name: string; privilege_type: string }[]>`
      select grantee, table_name, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('authenticated', 'anon')
        and privilege_type <> 'SELECT'
    `;
    expect([...tableGrants]).toEqual([]);
    const columnGrants = await db<{ grantee: string; table_name: string }[]>`
      select grantee, table_name from information_schema.column_privileges
      where table_schema = 'public' and grantee in ('authenticated', 'anon')
        and privilege_type <> 'SELECT'
    `;
    expect([...columnGrants]).toEqual([]);
  });

  test("authenticated reads only the Realtime tables; anon reads nothing", async () => {
    const rows = await db<{ grantee: string; table_name: string }[]>`
      select grantee, table_name from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('authenticated', 'anon') and privilege_type = 'SELECT'
      order by grantee, table_name
    `;
    const whole = REALTIME_TABLES.filter((t) => !Object.hasOwn(REALTIME_COLUMN_GRANTS, t));
    expect([...rows]).toEqual([...whole].sort().map((t) => ({ grantee: "authenticated", table_name: t })));
  });

  test("order_invoices: authenticated reads the status columns only, never request_payload (0017)", async () => {
    const rows = await db<{ column_name: string }[]>`
      select column_name from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'order_invoices' and grantee = 'authenticated'
        and privilege_type = 'SELECT'
      order by column_name
    `;
    expect(rows.map((r) => r.column_name)).toEqual([...REALTIME_COLUMN_GRANTS.order_invoices].sort());
    const denied = await errorCode(() =>
      withUserSession(db, a.adminId, (tx) => tx`select request_payload from public.order_invoices`),
    );
    expect(denied).toBe(INSUFFICIENT_PRIVILEGE);
  });

  test("app_service holds delete only where 05 'Role rules' allows it (ADR-018)", async () => {
    const rows = await db<{ table_name: string }[]>`
      select table_name from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'app_service' and privilege_type = 'DELETE'
      order by table_name`;
    const expected = SPECS.filter((s) => s.delete !== null)
      .map((s) => s.table as string)
      .concat(["rate_counters"])
      .sort();
    expect(rows.map((r) => r.table_name)).toEqual(expected);
  });

  test("app_service cannot bypass RLS", async () => {
    const [row] = await db<
      { rolbypassrls: boolean }[]
    >`select rolbypassrls from pg_roles where rolname = 'app_service'`;
    expect(row?.rolbypassrls).toBe(false);
  });

  test("every security definer function in schema mt pins search_path", async () => {
    const rows = await db<{ proname: string }[]>`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'mt' and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=pg_catalog, pg_temp')
    `;
    expect([...rows]).toEqual([]);
  });

  test("no function in schema mt is executable by public", async () => {
    const rows = await db<{ proname: string }[]>`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'mt' and has_function_privilege('public', p.oid, 'execute')
    `;
    expect([...rows]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant isolation, every tenant table
// ---------------------------------------------------------------------------

describe("cross-tenant isolation (NFR-001)", () => {
  for (const spec of SPECS) {
    describe(spec.table, () => {
      test("A's admin and A's system actor see zero rows of B", async () => {
        for (const ctx of [a.adminCtx, a.systemCtx]) {
          expect(await probe(ctx, selectOwn(spec, b))).toBe("denied");
        }
      });

      test("A cannot update, delete, or insert rows of B", async () => {
        for (const ctx of [a.adminCtx, a.systemCtx]) {
          expect(await probe(ctx, updateRow(spec, b))).toBe("denied");
          expect(await probe(ctx, deleteRow(spec, b))).toBe("denied");
          expect(await probe(ctx, insertRow(spec, b))).toBe("denied");
        }
      });

      test("no restaurant context reads and writes nothing (fail closed)", async () => {
        expect(await probe(null, selectOwn(spec, a))).toBe("denied");
        expect(await probe(null, updateRow(spec, a))).toBe("denied");
        expect(await probe(null, insertRow(spec, a))).toBe("denied");
      });

      test("A's admin sees only A's rows", async () => {
        if (spec.select === null) return;
        const rows = await asService(db, a.adminCtx, (tx) =>
          tx.unsafe<{ tenant: string }[]>(`select ${spec.tenantColumn}::text as tenant from public.${spec.table}`),
        );
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.tenant === a.restaurantId)).toBe(true);
      });

      test("the browser path (authenticated) never writes, and reads only Realtime tables of its own restaurant", async () => {
        const realtime = (REALTIME_TABLES as readonly string[]).includes(spec.table);
        const readA = await errorCode(() =>
          withUserSession(db, a.adminId, async (tx) => {
            const own = await tx.unsafe<{ count: number }[]>(
              `select count(*)::int as count from public.${spec.table} where ${spec.tenantColumn} = $1`,
              [a.restaurantId],
            );
            const other = await tx.unsafe<{ count: number }[]>(
              `select count(*)::int as count from public.${spec.table} where ${spec.tenantColumn} = $1`,
              [b.restaurantId],
            );
            if ((own[0]?.count ?? 0) === 0) throw new Error("member sees none of its own rows");
            if ((other[0]?.count ?? 0) !== 0) throw new Error("member sees another restaurant's rows");
          }),
        );
        expect(readA).toBe(realtime ? null : INSUFFICIENT_PRIVILEGE);

        for (const write of [
          (tx: Tx) => spec.insertRow(tx, a),
          (tx: Tx) =>
            tx.unsafe(`update public.${spec.table} set ${spec.updateSet} where ${spec.pkColumn} = $1`, [spec.pk(a)]),
          (tx: Tx) => tx.unsafe(`delete from public.${spec.table} where ${spec.pkColumn} = $1`, [spec.pk(a)]),
        ]) {
          expect(await errorCode(() => withUserSession(db, a.adminId, write))).toBe(INSUFFICIENT_PRIVILEGE);
        }
      });
    });
  }

  test("a user with no membership sees nothing on the browser path", async () => {
    for (const table of REALTIME_TABLES) {
      const rows = await withUserSession(db, outsiderId, (tx) =>
        tx.unsafe<{ count: number }[]>(`select count(*)::int as count from public.${table}`),
      );
      expect(rows[0]?.count).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Role rules on the service path (the RLS backstop of ADR-005)
// ---------------------------------------------------------------------------

describe("role rules (05.data-model.md 'Role rules')", () => {
  const actors = (f: RestaurantFixture, outsider: string) =>
    [
      { name: "admin", ctx: f.adminCtx, role: "admin" },
      { name: "attendant", ctx: f.attendantCtx, role: "attendant" },
      { name: "api key", ctx: f.apiKeyCtx, role: "attendant" },
      { name: "system", ctx: f.systemCtx, role: "admin" },
      { name: "revoked api key", ctx: { ...f.apiKeyCtx, apiKeyId: f.revokedApiKeyId }, role: null },
      { name: "another restaurant's api key", ctx: { ...f.apiKeyCtx, apiKeyId: b.apiKeyId }, role: null },
      { name: "user with no membership", ctx: { ...f.adminCtx, userId: outsider }, role: null },
    ] as const;

  for (const spec of SPECS) {
    test(`${spec.table}: read ${spec.select ?? "—"}, insert ${spec.insert ?? "—"}, update ${spec.update ?? "—"}, delete ${spec.delete ?? "—"}`, async () => {
      const mismatches: string[] = [];
      for (const actor of actors(a, outsiderId)) {
        const checks: [string, ReadRole | WriteRole, (tx: Tx) => Promise<{ count: number }>][] = [
          ["select", spec.select, selectOwn(spec, a)],
          ["insert", spec.insert, insertRow(spec, a)],
          ["update", spec.update, updateRow(spec, a)],
          ["delete", spec.delete, deleteRow(spec, a)],
        ];
        for (const [command, required, fn] of checks) {
          const want = expected(required, actor.role);
          const got = await probe(actor.ctx, fn);
          if (got !== want) mismatches.push(`${actor.name} ${command}: expected ${want}, got ${got}`);
        }
      }
      expect(mismatches).toEqual([]);
    });
  }

  test("restaurants: id and plan_code are not writable even by an admin", async () => {
    for (const set of ["plan_code = 'pro'", "id = gen_random_uuid()"]) {
      const code = await errorCode(() =>
        asService(db, a.adminCtx, (tx) =>
          tx.unsafe(`update public.restaurants set ${set} where id = $1`, [a.restaurantId]),
        ),
      );
      expect(code).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });

  test("stock_items.current_qty is not writable by an update", async () => {
    const code = await errorCode(() =>
      asService(
        db,
        a.adminCtx,
        (tx) => tx`update public.stock_items set current_qty = 999 where id = ${a.stockItemId}`,
      ),
    );
    expect(code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  test("plans are readable by every actor and writable by none", async () => {
    const rows = await asService(
      db,
      a.attendantCtx,
      (tx) => tx<{ code: string }[]>`select code from public.plans order by code`,
    );
    expect(rows.map((r) => r.code)).toEqual(["free", "pro"]);
    const code = await errorCode(() => asService(db, a.systemCtx, (tx) => tx`update public.plans set name = 'x'`));
    expect(code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

describe("helpers", () => {
  test("mt.set_context rejects an unknown actor type", async () => {
    const code = await errorCode(() =>
      asService(db, { restaurantId: a.restaurantId, actorType: "root" as never }, async () => {}),
    );
    expect(code).toBe("22023");
  });

  test("mt.actor_role resolves from data, per actor", async () => {
    const role = (ctx: RestaurantContext) =>
      asService(db, ctx, async (tx) => (await tx<{ r: string | null }[]>`select mt.actor_role() as r`)[0]?.r ?? null);
    expect(await role(a.adminCtx)).toBe("admin");
    expect(await role(a.attendantCtx)).toBe("attendant");
    expect(await role(a.apiKeyCtx)).toBe("attendant");
    expect(await role(a.systemCtx)).toBe("admin");
    expect(await role({ ...a.apiKeyCtx, apiKeyId: a.revokedApiKeyId })).toBeNull();
    // A's admin pointed at B's restaurant has no membership there.
    expect(await role({ ...a.adminCtx, restaurantId: b.restaurantId })).toBeNull();
  });

  test("mt.memberships_for_user lists one user's restaurants and roles", async () => {
    const rows = await withoutContext(
      db,
      (tx) => tx<{ restaurant_id: string; role: string }[]>`select * from mt.memberships_for_user(${a.attendantId})`,
    );
    expect([...rows]).toEqual([{ restaurant_id: a.restaurantId, role: "attendant" }]);
  });

  test("mt.api_key_lookup resolves a key by hash, before any context exists", async () => {
    const rows = await withoutContext(
      db,
      (tx) =>
        tx<{ id: string; restaurant_id: string }[]>`select id, restaurant_id from mt.api_key_lookup(${a.apiKeyHash})`,
    );
    expect([...rows]).toEqual([{ id: a.apiKeyId, restaurant_id: a.restaurantId }]);
  });

  test("mt.is_member and mt.is_admin answer for auth.uid() on the browser path", async () => {
    const rows = await withUserSession(
      db,
      a.attendantId,
      (tx) =>
        tx<{ member: boolean; admin: boolean; other: boolean }[]>`
        select mt.is_member(${a.restaurantId}) as member, mt.is_admin(${a.restaurantId}) as admin,
               mt.is_member(${b.restaurantId}) as other`,
    );
    expect(rows[0]).toEqual({ member: true, admin: false, other: false });
  });

  test("the last admin of a restaurant cannot be removed or demoted", async () => {
    for (const statement of [
      (tx: Tx) => tx`delete from public.restaurant_members where id = ${a.adminMemberId}`,
      (tx: Tx) => tx`update public.restaurant_members set role = 'attendant' where id = ${a.adminMemberId}`,
    ]) {
      const code = await errorCode(() => asService(db, a.adminCtx, statement));
      expect(code).toBe("23514");
    }
  });

  test("an integration must reference secrets of its own restaurant and kind", async () => {
    const code = await errorCode(() =>
      asService(
        db,
        a.adminCtx,
        (tx) =>
          tx`update public.integrations_whatsapp set api_key_secret_id = ${a.secretIds.webnfKey} where restaurant_id = ${a.restaurantId}`,
      ),
    );
    expect(code).toBe("23514");
  });
});
