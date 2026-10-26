// packages/db/src/restaurant-defaults.integration.test.ts
//
// covers FR-084, FR-200, ADR-026 Amendment 1, ADR-027
//
// A restaurant from mt.create_restaurant (onboarding) gets one automatic_messages
// row for each of the nine kinds, with the default texts and on/off values.

import { afterAll, beforeAll, expect, test } from "bun:test";

import type { Db } from "./client";
import { createTestDb, createUser } from "./test-harness";

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.end();
});

const EXPECTED: [string, boolean, string][] = [
  ["closed", true, "Olá! Estamos fora do nosso horário de atendimento. Retornaremos assim que abrirmos."],
  ["order_cancelled", true, "Seu pedido {{pedido}} foi cancelado. Se tiver dúvidas, responda esta mensagem."],
  ["order_confirmed", true, "Olá {{nome}}! Seu pedido {{pedido}} foi confirmado e logo entra em preparo."],
  ["order_delivered", true, "Pedido {{pedido}} entregue. Obrigado pela preferência, {{nome}}!"],
  ["order_out_for_delivery", true, "Seu pedido {{pedido}} saiu para entrega!"],
  ["order_preparing", true, "Seu pedido {{pedido}} está sendo preparado."],
  ["order_ready", true, "Seu pedido {{pedido}} está pronto! Pode vir retirar no {{restaurante}}."],
  ["order_received", true, "Recebemos seu pedido! Em breve confirmaremos os detalhes."],
  ["welcome", true, "Olá! Aqui é {{restaurante}}. Como podemos ajudar?"],
];

test("mt.create_restaurant, called as app_service, inserts the nine default automatic messages", async () => {
  const owner = await createUser(db, "defaults-owner");
  const id = await db.begin(async (tx) => {
    await tx`set local role app_service`;
    const [row] = await tx<{ id: string }[]>`select mt.create_restaurant('Defaults 0022', ${owner}) as id`;
    return row?.id ?? "";
  });
  const rows = await db<{ kind: string; enabled: boolean; body: string; template_name: string | null }[]>`
    select kind, enabled, body, template_name from public.automatic_messages
    where restaurant_id = ${id} order by kind`;
  expect(rows.map((r) => [r.kind, r.enabled, r.body])).toEqual(EXPECTED);
  expect(rows.every((r) => r.template_name === null)).toBe(true);
});

test("mt.insert_default_automatic_messages keeps rows that already exist", async () => {
  const owner = await createUser(db, "defaults-owner-2");
  const [r] = await db<{ id: string }[]>`select mt.create_restaurant('Defaults 0022 b', ${owner}) as id`;
  const id = r?.id ?? "";
  await db`update public.automatic_messages set enabled = false, body = 'Meu texto' where restaurant_id = ${id} and kind = 'welcome'`;
  await db`select mt.insert_default_automatic_messages(${id})`;
  const rows = await db<{ kind: string; enabled: boolean; body: string }[]>`
    select kind, enabled, body from public.automatic_messages where restaurant_id = ${id}`;
  expect(rows).toHaveLength(9);
  expect(rows.find((x) => x.kind === "welcome")).toEqual({ kind: "welcome", enabled: false, body: "Meu texto" });
});
