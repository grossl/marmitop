// packages/db/src/status-flow-migration.integration.test.ts
//
// covers FR-021, FR-022, FR-160, FR-200, NFR-062, ADR-028
//
// Migration 0025 removes `preparando`, renames `entregue` to `finalizado`, and
// leaves seven automatic message kinds. Applies 0000–0024 to a throwaway
// database, writes orders and history with the old names, then applies 0025.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDb, type Db } from "./client";
import { MIGRATIONS_DIR, runMigrations } from "./migrate";
import { DEFAULT_TEST_ADMIN_URL, prepareSupabaseSurface } from "./test-database";
import { testDatabaseUrl } from "./test-harness";

const DB_NAME = "mt_status_flow_migration_test";
const MIGRATION = "0025_status_flow_finalizado.sql";
const adminUrl = process.env.MT_TEST_ADMIN_URL ?? DEFAULT_TEST_ADMIN_URL;
let admin: Db;
let db: Db | undefined;
let url = "";
let dir = "";

beforeAll(async () => {
  await testDatabaseUrl(); // fails with a clear message when the stack is down
  admin = createDb(adminUrl, { max: 1 });
  await admin.unsafe(`drop database if exists ${DB_NAME} with (force)`);
  await admin.unsafe(`create database ${DB_NAME}`);
  const parsed = new URL(adminUrl);
  parsed.pathname = `/${DB_NAME}`;
  url = parsed.toString();
  await prepareSupabaseSurface(url);
  dir = mkdtempSync(join(tmpdir(), "mt-migrations-0025-"));
  for (const file of readdirSync(MIGRATIONS_DIR)) {
    if (file.endsWith(".sql") && file < MIGRATION) cpSync(join(MIGRATIONS_DIR, file), join(dir, file));
  }
});

// The database drop can wait on a checkpoint while other suites run, so the hook gets 30 s.
afterAll(async () => {
  await db?.end({ timeout: 5 });
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
  await admin?.unsafe(`drop database if exists ${DB_NAME} with (force)`);
  await admin?.end({ timeout: 5 });
}, 30_000);

type HistoryRow = { code: string; from_status: string | null; to_status: string };

test("0025 renames the statuses, cleans the history, and keeps seven message kinds", async () => {
  const quiet = { dir, log: () => {} };
  await runMigrations(url, quiet);
  db = createDb(url, { max: 1 });
  const conn = db;

  const [restaurant] = await conn<{ id: string }[]>`
    insert into public.restaurants (name) values ('Casa 0025') returning id`;
  const rid = restaurant?.id ?? "";
  await conn`select mt.insert_default_automatic_messages(${rid})`;
  const [customer] = await conn<{ id: string }[]>`
    insert into public.customers (restaurant_id, name, phone) values (${rid}, 'Ana', '+5511900000025') returning id`;
  const cid = customer?.id ?? "";

  const newOrder = async (code: string, fulfillment: "delivery" | "pickup") => {
    const address =
      fulfillment === "delivery" ? { logradouro: "Rua A", bairro: "Centro" } : { logradouro: null, bairro: null };
    const [row] = await conn<{ id: string }[]>`
      insert into public.orders
        (restaurant_id, code, customer_id, status, fulfillment, logradouro, bairro, payment_method,
         subtotal_cents, delivery_fee_cents, total_cents, source)
      values (${rid}, ${code}, ${cid}, 'aguardando', ${fulfillment}, ${address.logradouro}, ${address.bairro}, 'pix',
              0, 0, 0, 'counter')
      returning id`;
    return row?.id ?? "";
  };
  const move = (id: string, status: string) => conn`update public.orders set status = ${status} where id = ${id}`;

  // ORD-001: aguardando → confirmado → preparando (stays preparando)
  const o1 = await newOrder("ORD-001", "delivery");
  await move(o1, "confirmado");
  await move(o1, "preparando");
  // ORD-002: aguardando → preparando → pronto → entregue (pickup)
  const o2 = await newOrder("ORD-002", "pickup");
  await move(o2, "preparando");
  await move(o2, "pronto");
  await move(o2, "entregue");
  const [before] = await conn<{ updated_at: Date; delivered_at: Date | null }[]>`
    select updated_at, delivered_at from public.orders where id = ${o2}`;

  // A status message of a removed kind that was already sent stays a record.
  const [conv] = await conn<{ id: string }[]>`
    insert into public.conversations (restaurant_id, customer_id) values (${rid}, ${cid}) returning id`;
  await conn`
    insert into public.messages (restaurant_id, conversation_id, direction, body, status, automatic_kind)
    values (${rid}, ${conv?.id ?? ""}, 'out', 'Seu pedido está sendo preparado.', 'sent', 'order_preparing')`;

  cpSync(join(MIGRATIONS_DIR, MIGRATION), join(dir, MIGRATION));
  const applied = await runMigrations(url, quiet);
  expect(applied.applied).toEqual([MIGRATION]);

  const orders = await conn<{ code: string; status: string; updated_at: Date; delivered_at: Date | null }[]>`
    select code, status, updated_at, delivered_at from public.orders order by code`;
  expect(orders.map((o) => [o.code, o.status])).toEqual([
    ["ORD-001", "confirmado"],
    ["ORD-002", "finalizado"],
  ]);
  // The rename is not a move: no history row, no new updated_at, delivered_at kept.
  expect(orders[1]?.updated_at.getTime()).toBe(before?.updated_at.getTime());
  expect(orders[1]?.delivered_at?.getTime()).toBe(before?.delivered_at?.getTime());

  const history = await conn<HistoryRow[]>`
    select o.code, h.from_status, h.to_status
    from public.order_status_history h join public.orders o on o.id = h.order_id
    order by o.code, h.changed_at, h.id`;
  expect(history.map((h) => [h.code, h.from_status, h.to_status])).toEqual([
    ["ORD-001", null, "aguardando"],
    ["ORD-001", "aguardando", "confirmado"],
    ["ORD-002", null, "aguardando"],
    ["ORD-002", "aguardando", "confirmado"],
    ["ORD-002", "confirmado", "pronto"],
    ["ORD-002", "pronto", "finalizado"],
  ]);

  const kinds = await conn<{ kind: string }[]>`
    select kind from public.automatic_messages where restaurant_id = ${rid} order by kind`;
  expect(kinds.map((k) => k.kind)).toEqual([
    "closed",
    "order_cancelled",
    "order_confirmed",
    "order_out_for_delivery",
    "order_ready",
    "order_received",
    "welcome",
  ]);
  const removedKind = await conn`
    insert into public.automatic_messages (restaurant_id, kind, enabled, body)
    values (${rid}, 'order_delivered', true, 'x')`.catch((e: { code?: string }) => e);
  expect((removedKind as { code?: string }).code).toBe("23514");
  const [sent] = await conn<{ n: number }[]>`
    select count(*)::int as n from public.messages where automatic_kind = 'order_preparing'`;
  expect(sent?.n).toBe(1);
});

test("after 0025, pronto → finalizado sets delivered_at and paid_at; preparando and entregue are rejected", async () => {
  const conn = db;
  if (!conn) throw new Error("the first test did not run");
  const [o] = await conn<{ id: string }[]>`select id from public.orders where code = 'ORD-001'`;
  const id = o?.id ?? "";

  const preparando = await conn`update public.orders set status = 'preparando' where id = ${id}`.catch(
    (e: { code?: string }) => e,
  );
  expect((preparando as { code?: string }).code).toBe("23514");

  await conn`update public.orders set status = 'pronto' where id = ${id}`;
  const entregue = await conn`update public.orders set status = 'entregue' where id = ${id}`.catch(
    (e: { code?: string }) => e,
  );
  expect((entregue as { code?: string }).code).toBe("23514");

  await conn`update public.orders set status = 'finalizado' where id = ${id}`;
  const [row] = await conn<{ status: string; delivered_at: Date | null; paid_at: Date | null }[]>`
    select status, delivered_at, paid_at from public.orders where id = ${id}`;
  expect(row?.status).toBe("finalizado");
  expect(row?.delivered_at).not.toBeNull();
  expect(row?.paid_at).not.toBeNull();

  // finalizado is final.
  const back = await conn`update public.orders set status = 'saiu' where id = ${id}`.catch((e: { code?: string }) => e);
  expect((back as { code?: string }).code).toBe("23514");

  // The SQL table matches packages/core: pickup skips saiu.
  const [allowed] = await conn<{ pickup_saiu: boolean; delivery_saiu: boolean; prep: boolean }[]>`
    select mt.order_transition_allowed('pronto', 'saiu', 'pickup') as pickup_saiu,
           mt.order_transition_allowed('pronto', 'saiu', 'delivery') as delivery_saiu,
           mt.order_transition_allowed('confirmado', 'preparando', 'delivery') as prep`;
  expect(allowed).toEqual({ pickup_saiu: false, delivery_saiu: true, prep: false });
});
