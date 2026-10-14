// packages/db/src/tenant-fks.integration.test.ts
//
// covers NFR-001, FR-049, FR-089
//
// Composite tenant foreign keys (ADR-018, 05.data-model.md "Tenant foreign
// keys"). RLS checks the child row's own restaurant_id; the composite key
// checks that the parent it points at belongs to the same restaurant. Each
// probe runs on app_service with the correct context of the child's
// restaurant, as the system actor, so RLS passes and only the key can refuse.
//
// Also: mt.touch_api_key, the one write path an API key actor has into
// api_keys (FR-089 "last use").

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { Db, Tx } from "./client";
import {
  asService,
  CHECK_VIOLATION,
  createTestDb,
  errorCode,
  type RestaurantFixture,
  seedRestaurant,
  truncateAll,
} from "./test-harness";
import { TENANT_TABLES } from "./types";

const FOREIGN_KEY_VIOLATION = "23503";

let db: Db;
let a: RestaurantFixture;
let b: RestaurantFixture;

beforeAll(async () => {
  db = await createTestDb();
  await truncateAll(db);
  a = await seedRestaurant(db, "Chaves A");
  b = await seedRestaurant(db, "Chaves B");
});

afterAll(async () => {
  await db?.end({ timeout: 5 });
});

class Rollback extends Error {}

/** Runs `fn` as A's system actor, rolls back, and returns the SQLSTATE (null on success). */
function asA(fn: (tx: Tx) => Promise<unknown>): Promise<string | null> {
  return errorCode(async () => {
    try {
      await asService(db, a.systemCtx, async (tx) => {
        await fn(tx);
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  });
}

interface Case {
  name: string;
  /** The same statement with A's own parent, which must succeed. */
  own: (tx: Tx) => Promise<unknown>;
  /** The statement pointing at B's parent, which must fail. */
  foreign: (tx: Tx) => Promise<unknown>;
  /** Codes that count as a refusal. The secret-kind trigger may refuse before the key does. */
  codes?: string[];
}

const CASES: Case[] = [
  {
    name: "conversations.customer_id -> customers",
    own: async (tx) => {
      const [c] = await tx<{ id: string }[]>`
        insert into public.customers (restaurant_id, name, phone) values (${a.restaurantId}, 'Novo', '+5511900000001') returning id`;
      await tx`insert into public.conversations (restaurant_id, customer_id) values (${a.restaurantId}, ${c?.id ?? ""})`;
    },
    foreign: (tx) =>
      tx`insert into public.conversations (restaurant_id, customer_id) values (${a.restaurantId}, ${b.customerId})`,
  },
  {
    name: "messages.conversation_id -> conversations",
    own: (tx) => tx`
      insert into public.messages (restaurant_id, conversation_id, direction, body, status)
      values (${a.restaurantId}, ${a.conversationId}, 'out', 'Olá', 'pending')`,
    foreign: (tx) => tx`
      insert into public.messages (restaurant_id, conversation_id, direction, body, status)
      values (${a.restaurantId}, ${b.conversationId}, 'out', 'Olá', 'pending')`,
  },
  {
    name: "messages.order_id -> orders",
    own: (tx) => tx`update public.messages set order_id = ${a.orderId} where id = ${a.messageId}`,
    foreign: (tx) => tx`update public.messages set order_id = ${b.orderId} where id = ${a.messageId}`,
  },
  {
    name: "menu_item_sizes.menu_item_id -> menu_items",
    own: (tx) => tx`
      insert into public.menu_item_sizes (restaurant_id, menu_item_id, name, price_cents)
      values (${a.restaurantId}, ${a.menuItemId}, 'G', 2390)`,
    foreign: (tx) => tx`
      insert into public.menu_item_sizes (restaurant_id, menu_item_id, name, price_cents)
      values (${a.restaurantId}, ${b.menuItemId}, 'G', 2390)`,
  },
  {
    name: "orders.customer_id -> customers",
    own: (tx) => tx`update public.orders set customer_id = ${a.customerId} where id = ${a.orderId}`,
    foreign: (tx) => tx`update public.orders set customer_id = ${b.customerId} where id = ${a.orderId}`,
  },
  {
    name: "orders.conversation_id -> conversations",
    own: (tx) => tx`update public.orders set conversation_id = ${a.conversationId} where id = ${a.orderId}`,
    foreign: (tx) => tx`update public.orders set conversation_id = ${b.conversationId} where id = ${a.orderId}`,
  },
  {
    name: "orders.created_by_api_key -> api_keys",
    own: (tx) => tx`update public.orders set created_by_api_key = ${a.apiKeyId} where id = ${a.orderId}`,
    foreign: (tx) => tx`update public.orders set created_by_api_key = ${b.apiKeyId} where id = ${a.orderId}`,
  },
  {
    name: "order_items.order_id -> orders",
    own: (tx) => tx`update public.order_items set notes = 'ok' where order_id = ${a.orderId}`,
    foreign: (tx) => tx`
      insert into public.order_items (restaurant_id, order_id, name, unit_price_cents, qty)
      values (${a.restaurantId}, ${b.orderId}, 'Intruso', 100, 1)`,
  },
  {
    name: "order_items.menu_item_id -> menu_items",
    own: (tx) => tx`update public.order_items set menu_item_id = ${a.menuItemId} where id = ${a.orderItemId}`,
    foreign: (tx) => tx`update public.order_items set menu_item_id = ${b.menuItemId} where id = ${a.orderItemId}`,
  },
  {
    name: "order_status_history.order_id -> orders",
    own: (tx) => tx`
      insert into public.order_status_history (restaurant_id, order_id, from_status, to_status, actor_type)
      values (${a.restaurantId}, ${a.orderId}, 'aguardando', 'confirmado', 'system')`,
    foreign: (tx) => tx`
      insert into public.order_status_history (restaurant_id, order_id, from_status, to_status, actor_type)
      values (${a.restaurantId}, ${b.orderId}, 'aguardando', 'confirmado', 'system')`,
  },
  {
    name: "order_invoices.order_id -> orders",
    own: (tx) => tx`
      insert into public.order_invoices (restaurant_id, order_id, kind, status)
      values (${a.restaurantId}, ${a.orderId}, 'nfce', 'rejected')`,
    foreign: (tx) => tx`
      insert into public.order_invoices (restaurant_id, order_id, kind, status)
      values (${a.restaurantId}, ${b.orderId}, 'nfce', 'rejected')`,
  },
  {
    name: "stock_movements.stock_item_id -> stock_items",
    own: (tx) => tx`
      insert into public.stock_movements (restaurant_id, stock_item_id, kind, qty, balance_after)
      values (${a.restaurantId}, ${a.stockItemId}, 'in', 1, 0)`,
    foreign: (tx) => tx`
      insert into public.stock_movements (restaurant_id, stock_item_id, kind, qty, balance_after)
      values (${a.restaurantId}, ${b.stockItemId}, 'in', 1, 0)`,
  },
  {
    name: "webhook_deliveries.endpoint_id -> webhook_endpoints",
    own: (tx) => tx`
      insert into public.webhook_deliveries (restaurant_id, endpoint_id, event, payload)
      values (${a.restaurantId}, ${a.webhookEndpointId}, 'order.created', '{}'::jsonb)`,
    foreign: (tx) => tx`
      insert into public.webhook_deliveries (restaurant_id, endpoint_id, event, payload)
      values (${a.restaurantId}, ${b.webhookEndpointId}, 'order.created', '{}'::jsonb)`,
  },
  {
    name: "webhook_endpoints.secret_id -> secrets",
    own: (tx) =>
      tx`update public.webhook_endpoints set secret_id = ${a.secretIds.outbound} where id = ${a.webhookEndpointId}`,
    foreign: (tx) =>
      tx`update public.webhook_endpoints set secret_id = ${b.secretIds.outbound} where id = ${a.webhookEndpointId}`,
    codes: [FOREIGN_KEY_VIOLATION, CHECK_VIOLATION],
  },
  {
    name: "integrations_whatsapp.*_secret_id -> secrets",
    own: (tx) =>
      tx`update public.integrations_whatsapp set api_key_secret_id = ${a.secretIds.uatisKey} where restaurant_id = ${a.restaurantId}`,
    foreign: (tx) =>
      tx`update public.integrations_whatsapp set api_key_secret_id = ${b.secretIds.uatisKey} where restaurant_id = ${a.restaurantId}`,
    codes: [FOREIGN_KEY_VIOLATION, CHECK_VIOLATION],
  },
  {
    name: "integrations_fiscal.*_secret_id -> secrets",
    own: (tx) =>
      tx`update public.integrations_fiscal set webhook_secret_id = ${a.secretIds.webnfWebhook} where restaurant_id = ${a.restaurantId}`,
    foreign: (tx) =>
      tx`update public.integrations_fiscal set webhook_secret_id = ${b.secretIds.webnfWebhook} where restaurant_id = ${a.restaurantId}`,
    codes: [FOREIGN_KEY_VIOLATION, CHECK_VIOLATION],
  },
];

describe("composite tenant foreign keys (ADR-018)", () => {
  for (const c of CASES) {
    test(`${c.name}: own parent passes, another restaurant's parent fails`, async () => {
      expect(await asA(c.own)).toBeNull();
      expect(c.codes ?? [FOREIGN_KEY_VIOLATION]).toContain((await asA(c.foreign)) ?? "none");
    });
  }

  test("the composite key holds even when the trigger is out of the way (secrets)", async () => {
    // The secret-kind trigger also checks the restaurant. Pause it to prove the key alone refuses.
    const code = await errorCode(() =>
      db.begin(async (tx) => {
        await tx`alter table public.webhook_endpoints disable trigger webhook_endpoints_secret_kind`;
        await tx`update public.webhook_endpoints set secret_id = ${b.secretIds.outbound} where id = ${a.webhookEndpointId}`;
      }),
    );
    expect(code).toBe(FOREIGN_KEY_VIOLATION);
  });

  test("meta: every foreign key between tenant tables carries restaurant_id on both sides", async () => {
    const tenant = (TENANT_TABLES as readonly string[]).filter((t) => t !== "restaurants");
    const rows = await db<
      { conname: string; child: string; parent: string; child_cols: string[]; parent_cols: string[] }[]
    >`
      select c.conname,
             cl.relname as child,
             pl.relname as parent,
             array(select a.attname::text from unnest(c.conkey) k join pg_attribute a
                   on a.attrelid = c.conrelid and a.attnum = k) as child_cols,
             array(select a.attname::text from unnest(c.confkey) k join pg_attribute a
                   on a.attrelid = c.confrelid and a.attnum = k) as parent_cols
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_class pl on pl.oid = c.confrelid
      join pg_namespace n on n.oid = cl.relnamespace
      where c.contype = 'f' and n.nspname = 'public'
        and cl.relname = any(${tenant}) and pl.relname = any(${tenant})`;
    expect(rows.length).toBeGreaterThanOrEqual(CASES.length);
    const loose = rows
      .filter((r) => !r.child_cols.includes("restaurant_id") || !r.parent_cols.includes("restaurant_id"))
      .map((r) => `${r.child}.${r.conname} -> ${r.parent}`);
    expect(loose).toEqual([]);
  });
});

describe("mt.touch_api_key (FR-089)", () => {
  const lastUsed = async (id: string) =>
    (await db<{ at: Date | null }[]>`select last_used_at as at from public.api_keys where id = ${id}`)[0]?.at ?? null;
  const touch = (id: string, ctx = a.apiKeyCtx) =>
    asService(db, ctx, async (tx) => (await tx<{ ok: boolean }[]>`select mt.touch_api_key(${id}) as ok`)[0]?.ok);

  test("an API key actor records its use, at most once a minute", async () => {
    await db`update public.api_keys set last_used_at = null where id = ${a.apiKeyId}`;
    expect(await touch(a.apiKeyId)).toBe(true);
    const first = await lastUsed(a.apiKeyId);
    expect(first).toBeInstanceOf(Date);
    expect(await touch(a.apiKeyId)).toBe(false);
    expect(await lastUsed(a.apiKeyId)).toEqual(first);

    await db`update public.api_keys set last_used_at = now() - interval '61 seconds' where id = ${a.apiKeyId}`;
    expect(await touch(a.apiKeyId)).toBe(true);
    expect(((await lastUsed(a.apiKeyId)) ?? new Date(0)).getTime()).toBeGreaterThan(Date.now() - 30_000);
  });

  test("it cannot touch another restaurant's key", async () => {
    await db`update public.api_keys set last_used_at = null where id = ${b.apiKeyId}`;
    expect(await touch(b.apiKeyId)).toBe(false);
    expect(await lastUsed(b.apiKeyId)).toBeNull();
  });

  test("the API key actor still has no direct write on api_keys", async () => {
    const result = await asService(
      db,
      a.apiKeyCtx,
      (tx) => tx`update public.api_keys set last_used_at = now(), name = 'x' where id = ${a.apiKeyId}`,
    );
    expect(result.count).toBe(0);
  });
});
