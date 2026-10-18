// eval:ai (FR-199): runs CASES against the real model on the integration-test database. Costs money.
// Usage: ANTHROPIC_API_KEY=… bun run --cwd apps/worker eval:ai [--case "<name>"] [--dry]
// --dry runs one case with a scripted model: no network, no key. It checks the harness, not the model.

import { AI_TURN_BUDGET_MS, type AssistantModel, ScriptedAssistantModel, type ScriptedStep } from "@mt/core";
import type { Db } from "@mt/db";
import { createTestDb, type RestaurantFixture, seedRestaurant, truncateAll } from "@mt/db/test-harness";
import { runAiTurn, type ServiceDeps } from "@mt/http";
import { createTestServiceDeps } from "@mt/http/testing";

import { AnthropicAssistantModel } from "../src/ai/anthropic-model";
import { readAiConfig } from "../src/ai/config";
import { CASES, type EvalCase, PAYMENT_WORDS } from "./cases";

// USD per million tokens. An estimate: cache writes are not priced. Unknown models print "n/d".
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
};

const DRY_CASE = "pickup, one item with size";

interface MenuIds {
  readonly items: Record<string, { id: string; sizes: Record<string, string> }>;
}

async function seedEvalMenu(db: Db, restaurantId: string, c: EvalCase): Promise<MenuIds> {
  await db`update public.menu_items set archived_at = now() where restaurant_id = ${restaurantId}`;
  const ids: MenuIds = { items: {} };
  const meal = async (name: string, sizes: [string, number][]) => {
    const [m] = await db<{ id: string }[]>`
      insert into public.menu_items (restaurant_id, kind, name, category, price_cents)
      values (${restaurantId}, 'meal', ${name}, 'proteinas', ${sizes[0]![1]}) returning id`;
    const entry = { id: m!.id, sizes: {} as Record<string, string> };
    for (const [i, [s, p]] of sizes.entries()) {
      const [row] = await db<{ id: string }[]>`
        insert into public.menu_item_sizes (restaurant_id, menu_item_id, name, price_cents, position)
        values (${restaurantId}, ${m!.id}, ${s}, ${p}, ${i}) returning id`;
      entry.sizes[s] = row!.id;
    }
    ids.items[name] = entry;
  };
  await meal("Marmita de Frango", [
    ["Pequena", 1800],
    ["Grande", 2200],
  ]);
  await meal("Marmita de Carne", [
    ["Pequena", 2000],
    ["Grande", 2500],
  ]);
  const [drink] = await db<{ id: string }[]>`
    insert into public.menu_items (restaurant_id, kind, name, category, price_cents, volume)
    values (${restaurantId}, 'drink', 'Coca-Cola Lata', 'refrigerantes', 600, '350ml') returning id`;
  ids.items["Coca-Cola Lata"] = { id: drink!.id, sizes: {} };

  // The fixture opens Monday only. Open all seven days, or close all of them for a closed-restaurant case.
  const open = !(c.settings?.closedToday ?? false);
  for (let weekday = 0; weekday <= 6; weekday++) {
    await db`insert into public.business_hours (restaurant_id, weekday, enabled, opens_at, closes_at)
             values (${restaurantId}, ${weekday}, ${open}, '00:00', '23:59')
             on conflict (restaurant_id, weekday) do update set enabled = ${open}, opens_at = '00:00', closes_at = '23:59'`;
  }
  const allowPickup = c.settings?.allowPickup ?? true;
  await db`update public.restaurant_settings set allow_pickup = ${allowPickup}, delivery_fee_cents = 500 where restaurant_id = ${restaurantId}`;
  // The fixture row has the assistant off.
  await db`insert into public.ai_settings (restaurant_id, enabled) values (${restaurantId}, true)
           on conflict (restaurant_id) do update set enabled = true`;
  return ids;
}

/** Scripts for --dry: one model step list per customer turn, built from the seeded menu ids. */
function dryScript(c: EvalCase, menu: MenuIds): ScriptedStep[] {
  if (c.name !== DRY_CASE) throw new Error(`--dry has no script for "${c.name}"`);
  const frango = menu.items["Marmita de Frango"]!;
  const item = { menu_item_id: frango.id, size_id: frango.sizes.Grande, quantity: 1, notes: null };
  return [
    {
      tools: [{ name: "update_cart", input: { items: [item], fulfillment: null, address: null, customer_name: null } }],
    },
    { text: "Anotei uma Marmita de Frango Grande. Retirada ou entrega?" },
    {
      tools: [
        { name: "update_cart", input: { items: null, fulfillment: "pickup", address: null, customer_name: null } },
      ],
    },
    { tools: [{ name: "send_order_summary", input: {} }] },
    { text: "Posso confirmar o pedido?" },
    { tools: [{ name: "place_order", input: {} }] },
    { text: "Pedido confirmado! Pode retirar em breve." },
  ];
}

type OrderRow = { id: string; fulfillment: string; bairro: string | null };

/** Orders the assistant created in this case: never the fixture's own order. */
function caseOrders(db: Db, r: RestaurantFixture): Promise<OrderRow[]> {
  return db<OrderRow[]>`
    select id, fulfillment, bairro from public.orders
    where restaurant_id = ${r.restaurantId} and id <> ${r.orderId} and source = 'whatsapp'
      and ai_run_id in (select id from public.ai_runs where restaurant_id = ${r.restaurantId} and id <> ${r.aiRunId})`;
}

async function runCase(
  db: Db,
  deps: ServiceDeps,
  c: EvalCase,
  makeModel: (menu: MenuIds) => AssistantModel,
  modelName: string,
  progress: { r?: RestaurantFixture; turn: number },
) {
  await truncateAll(db);
  const r: RestaurantFixture = await seedRestaurant(db, `eval-${crypto.randomUUID().slice(0, 8)}`);
  progress.r = r;
  const menu = await seedEvalMenu(db, r.restaurantId, c);
  // Start clean: no seeded history, no saved customer address, no seeded cart.
  await db`delete from public.messages where conversation_id = ${r.conversationId}`;
  await db`delete from public.ai_carts where restaurant_id = ${r.restaurantId}`;
  await db`update public.customers set logradouro = null, numero = null, bairro = null where id = ${r.customerId}`;
  const model = makeModel(menu);

  let replies: string[] = [];
  let early = false;
  for (const [turn, text] of c.customer.entries()) {
    progress.turn = turn;
    const [m] = await db<{ id: string }[]>`
      insert into public.messages (restaurant_id, conversation_id, direction, body, status)
      values (${r.restaurantId}, ${r.conversationId}, 'in', ${text}, 'delivered') returning id`;
    await db`update public.conversations set last_inbound_at = now() where id = ${r.conversationId}`;
    await runAiTurn(
      deps,
      model,
      {
        v: 1,
        restaurantId: r.restaurantId,
        conversationId: r.conversationId,
        triggerMessageId: m!.id,
        enqueuedAt: new Date().toISOString(),
      },
      { budget: AbortSignal.timeout(AI_TURN_BUDGET_MS) },
    );
    const out = await db<{ body: string }[]>`
      select body from public.messages
      where conversation_id = ${r.conversationId} and direction = 'out' and ai_run_id is not null
      order by created_at`;
    replies = out.map((o) => o.body);
    const [conv] = await db<
      { ai_mode: string }[]
    >`select ai_mode from public.conversations where id = ${r.conversationId}`;
    if (turn < c.customer.length - 1 && (await caseOrders(db, r)).length > 0) {
      early = true;
      break;
    }
    if (conv?.ai_mode === "paused") break;
  }

  const failures: string[] = [];
  if (early) failures.push("order before confirmation");
  const orders = await caseOrders(db, r);
  if (c.expect.order === null) {
    if (orders.length > 0) failures.push("an order was created");
  } else if (orders.length !== 1) {
    failures.push(orders.length === 0 ? "no order" : `${orders.length} orders`);
  } else {
    const o = orders[0]!;
    if (o.fulfillment !== c.expect.order.fulfillment) failures.push(`fulfillment ${o.fulfillment}`);
    if (c.expect.order.bairro && o.bairro?.toLowerCase() !== c.expect.order.bairro.toLowerCase())
      failures.push(`bairro ${o.bairro}`);
    const items = await db<{ name: string; size_name: string | null; qty: number }[]>`
      select name, size_name, qty from public.order_items where order_id = ${o.id} order by position`;
    const got = items
      .map((i) => `${i.qty}x ${i.name}/${i.size_name}`)
      .sort()
      .join(", ");
    const want = c.expect.order.items
      .map((i) => `${i.qty}x ${i.name}/${i.size}`)
      .sort()
      .join(", ");
    if (got !== want) failures.push(`items ${got} ≠ ${want}`);
  }
  if (c.expect.pausedFor) {
    const [conv] = await db<{ ai_mode: string; ai_pause_reason: string | null }[]>`
      select ai_mode, ai_pause_reason from public.conversations where id = ${r.conversationId}`;
    if (conv?.ai_mode !== "paused" || conv.ai_pause_reason !== c.expect.pausedFor)
      failures.push(`${conv?.ai_mode} for ${conv?.ai_pause_reason}`);
  }
  for (const word of [...PAYMENT_WORDS, ...(c.expect.neverSays ?? [])]) {
    if (replies.some((t) => t.toLowerCase().includes(word.toLowerCase()))) failures.push(`said "${word}"`);
  }
  const [usage] = await db<{ i: number; o: number; cr: number }[]>`
    select coalesce(sum(input_tokens),0)::int as i, coalesce(sum(output_tokens),0)::int as o,
           coalesce(sum(cache_read_tokens),0)::int as cr
    from public.ai_runs where restaurant_id = ${r.restaurantId} and id <> ${r.aiRunId}`;
  const price = PRICES[modelName];
  const cost =
    price === undefined
      ? null
      : ((usage?.i ?? 0) * price.input + (usage?.o ?? 0) * price.output + (usage?.cr ?? 0) * price.cacheRead) / 1e6;
  // An order that should not exist, or that exists before the final message, is an unconfirmed order.
  const unconfirmed = early || (c.expect.order === null && orders.length > 0);
  return { failures, cost, unconfirmed };
}

const dry = process.argv.includes("--dry");
const ai = readAiConfig();
if (!dry && ai.apiKey === null) {
  console.error("eval:ai needs ANTHROPIC_API_KEY (or --dry for a scripted run without the model)");
  process.exit(2);
}
const caseIdx = process.argv.indexOf("--case");
const caseArg = caseIdx >= 0 ? process.argv[caseIdx + 1] : undefined;
if (caseIdx >= 0 && (caseArg === undefined || caseArg.startsWith("--"))) {
  console.error('eval:ai: --case needs a case name, for example --case "audio"');
  process.exit(2);
}
const only = caseArg ?? (dry ? DRY_CASE : undefined);
const selected = CASES.filter((x) => only === undefined || x.name === only);
if (selected.length === 0) {
  console.error(`eval:ai: no case named "${only}"`);
  process.exit(2);
}
if (dry && selected.some((c) => c.name !== DRY_CASE)) {
  console.error(`eval:ai --dry has a script only for "${DRY_CASE}"`);
  process.exit(2);
}

const modelName = dry ? "scripted" : ai.model;
const db = await createTestDb();
let passed = 0;
let unconfirmed = 0;
let cost: number | null = 0;
try {
  const deps = createTestServiceDeps(db, { clock: { now: () => new Date() } });
  const real = !dry && ai.apiKey !== null ? AnthropicAssistantModel.fromConfig({ ...ai, apiKey: ai.apiKey }) : null;
  for (const c of selected) {
    const progress: { r?: RestaurantFixture; turn: number } = { turn: 0 };
    try {
      const r = await runCase(
        db,
        deps,
        c,
        (menu) => real ?? new ScriptedAssistantModel(dryScript(c, menu)),
        modelName,
        progress,
      );
      cost = cost === null || r.cost === null ? null : cost + r.cost;
      if (r.unconfirmed) unconfirmed += 1;
      if (r.failures.length === 0) passed += 1;
      console.log(
        `${r.failures.length === 0 ? "PASS" : "FAIL"}  ${c.name}${r.failures.length ? `  — ${r.failures.join("; ")}` : ""}`,
      );
    } catch (error: unknown) {
      // An error mid-run must still count any order that should not exist.
      try {
        if (progress.r !== undefined) {
          const orders = await caseOrders(db, progress.r);
          if (orders.length > 0 && (c.expect.order === null || progress.turn < c.customer.length - 1)) unconfirmed += 1;
        }
      } catch {
        // The database check itself failed: nothing more to count.
      }
      // Name and code only: an error message could carry request data.
      const e = error as { name?: unknown; code?: unknown };
      const code = typeof e.code === "string" ? ` ${e.code}` : "";
      console.log(`FAIL  ${c.name}  — error ${String(e.name ?? "Error")}${code}`);
    }
  }
} finally {
  const total = selected.length;
  console.log(
    `\n${passed}/${total} passed (${Math.round((passed / Math.max(total, 1)) * 100)}%) · model ${dry ? "scripted (dry)" : ai.model} · est. cost US$ ${cost === null ? "n/d" : cost.toFixed(4)}`,
  );
  console.log(`Pedidos sem confirmação: ${unconfirmed}`);
  await db.end();
  process.exitCode = passed / Math.max(selected.length, 1) >= 0.9 && unconfirmed === 0 ? 0 : 1;
}
process.exit(process.exitCode);
