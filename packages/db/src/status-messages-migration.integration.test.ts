// packages/db/src/status-messages-migration.integration.test.ts
//
// covers FR-200, NFR-062, ADR-026
//
// Migration 0021 inserts the six order status messages, with the ADR-026 texts
// and on/off defaults, for every restaurant that exists when it runs. Applies
// 0000–0020 to a throwaway database, adds two restaurants, then applies 0021.
// Migration 0025 (ADR-028) later removes order_preparing and order_delivered,
// leaving seven kinds; status-flow-migration.integration.test.ts covers that.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDb, type Db } from "./client";
import { MIGRATIONS_DIR, runMigrations } from "./migrate";
import { DEFAULT_TEST_ADMIN_URL, prepareSupabaseSurface } from "./test-database";
import { testDatabaseUrl } from "./test-harness";

const DB_NAME = "mt_status_messages_migration_test";
const MIGRATION = "0021_order_status_messages.sql";
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
  dir = mkdtempSync(join(tmpdir(), "mt-migrations-0021-"));
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

test("0021 inserts the six status messages per existing restaurant with the ADR-026 defaults", async () => {
  const quiet = { dir, log: () => {} };
  await runMigrations(url, quiet);
  db = createDb(url, { max: 1 });
  const restaurants = await db<{ id: string }[]>`
    insert into public.restaurants (name) values ('Casa 0021'), ('Minas 0021') returning id`;
  const first = restaurants[0]?.id ?? "";
  await db`insert into public.automatic_messages (restaurant_id, kind, enabled, body) values (${first}, 'welcome', true, 'Oi')`;

  cpSync(join(MIGRATIONS_DIR, MIGRATION), join(dir, MIGRATION));
  const applied = await runMigrations(url, quiet);
  expect(applied.applied).toEqual([MIGRATION]);

  const expected = [
    ["order_cancelled", true, "Seu pedido {{pedido}} foi cancelado. Se tiver dúvidas, responda esta mensagem."],
    ["order_confirmed", true, "Olá {{nome}}! Seu pedido {{pedido}} foi confirmado e logo entra em preparo."],
    ["order_delivered", false, "Pedido {{pedido}} entregue. Obrigado pela preferência, {{nome}}!"],
    ["order_out_for_delivery", true, "Seu pedido {{pedido}} saiu para entrega!"],
    ["order_preparing", false, "Seu pedido {{pedido}} está sendo preparado."],
    ["order_ready", true, "Seu pedido {{pedido}} está pronto! Pode vir retirar no {{restaurante}}."],
  ];
  for (const r of restaurants) {
    const rows = await db<{ kind: string; enabled: boolean; body: string; template_name: string | null }[]>`
      select kind, enabled, body, template_name from public.automatic_messages
      where restaurant_id = ${r.id} and kind like 'order\\_%' and kind <> 'order_received'
      order by kind`;
    expect(rows.map((x) => [x.kind, x.enabled, x.body])).toEqual(expected);
    expect(rows.every((x) => x.template_name === null)).toBe(true);
  }
  const [welcome] = await db<{ body: string }[]>`
    select body from public.automatic_messages where restaurant_id = ${first} and kind = 'welcome'`;
  expect(welcome?.body).toBe("Oi");

  // The widened checks accept a status kind on messages too.
  const [conv] = await db<{ id: string }[]>`
    with c as (
      insert into public.customers (restaurant_id, name, phone) values (${first}, 'Ana', '+5511900000001') returning id
    )
    insert into public.conversations (restaurant_id, customer_id) select ${first}, id from c returning id`;
  await db`
    insert into public.messages (restaurant_id, conversation_id, direction, body, status, automatic_kind)
    values (${first}, ${conv?.id ?? ""}, 'out', 'Seu pedido saiu', 'pending', 'order_out_for_delivery')`;
});
