// covers FR-182, FR-183, FR-186, FR-187, FR-191, FR-192, FR-196, FR-198
import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { AssistantModelError, ScriptedAssistantModel } from "@mt/core";
import type { Db } from "@mt/db";
import { createTestDb, type RestaurantFixture, seedRestaurant, truncateQueues } from "@mt/db/test-harness";
import type { AiTurnJob } from "@mt/schemas";

import type { ServiceDeps } from "../../deps";
import { createTestServiceDeps } from "../../testing";
import { runAiTurn } from "./turn";

let db: Db;
let deps: ServiceDeps;
let a: RestaurantFixture;
let t = Date.parse("2026-10-13T15:00:00Z");
const clock = { now: () => new Date(t) };

async function inbound(body: string): Promise<string> {
  t += 1000;
  const [m] = await db<{ id: string }[]>`
    insert into public.messages (restaurant_id, conversation_id, direction, body, status, created_at)
    values (${a.restaurantId}, ${a.conversationId}, 'in', ${body}, 'delivered', ${new Date(t)}) returning id`;
  await db`update public.conversations set last_inbound_at = ${new Date(t)} where id = ${a.conversationId}`;
  return m!.id;
}
const job = (triggerMessageId: string, enqueuedAt = new Date(t)): AiTurnJob => ({
  v: 1,
  restaurantId: a.restaurantId,
  conversationId: a.conversationId,
  triggerMessageId,
  enqueuedAt: enqueuedAt.toISOString(),
});
const lastRun = async () =>
  (
    await db<{ status: string; model_calls: number; billed_as: string | null; tool_calls: { name: string }[] }[]>`
    select status, model_calls, billed_as, tool_calls from public.ai_runs where restaurant_id = ${a.restaurantId}
    order by started_at desc limit 1`
  )[0];

beforeAll(async () => {
  db = await createTestDb();
  deps = createTestServiceDeps(db, { clock });
  a = await seedRestaurant(db, "turn-a");
  // The seed opens Monday only. Open every weekday all day.
  for (let weekday = 0; weekday <= 6; weekday++) {
    await db`insert into public.business_hours (restaurant_id, weekday, enabled, opens_at, closes_at)
             values (${a.restaurantId}, ${weekday}, true, '00:00', '23:59')
             on conflict (restaurant_id, weekday) do update set enabled = true, opens_at = '00:00', closes_at = '23:59'`;
  }
  await db`update public.restaurants set plan_code = 'free' where id = ${a.restaurantId}`;
  // The fixture already has an ai_settings row with the assistant off.
  await db`insert into public.ai_settings (restaurant_id, enabled) values (${a.restaurantId}, true)
           on conflict (restaurant_id) do update set enabled = true`;
  // The seed message is stamped with the database clock (after the test clock). Move it before,
  // or it would stay the latest inbound and every job would be superseded.
  await db`update public.messages set created_at = ${new Date(t - 3_600_000)} where conversation_id = ${a.conversationId}`;
});
beforeEach(async () => {
  await truncateQueues(db);
  await db`update public.conversations set ai_mode = 'auto', ai_pause_reason = null, ai_turn_claimed_at = null where id = ${a.conversationId}`;
  await db`delete from public.ai_carts where restaurant_id = ${a.restaurantId}`;
});
afterAll(async () => db.end());

describe("runAiTurn", () => {
  test("a reply goes out with ai_run_id and one ai.reply usage row", async () => {
    const trigger = await inbound("oi, tem marmita hoje?");
    const model = new ScriptedAssistantModel([{ text: "Oi! Temos sim. O que vai querer?" }]);
    const out = await runAiTurn(deps, model, job(trigger));
    expect(out).toMatchObject({ kind: "done", status: "replied" });
    const [m] = await db<{ body: string; ai_run_id: string }[]>`
      select body, ai_run_id from public.messages where conversation_id = ${a.conversationId} and direction = 'out'
      order by created_at desc limit 1`;
    expect(m?.body).toBe("Oi! Temos sim. O que vai querer?");
    expect(m?.ai_run_id).toBe(out.runId);
    const [u] = await db<
      { n: number }[]
    >`select count(*)::int as n from public.usage_events where ref_id = ${out.runId} and kind = 'ai.reply'`;
    expect(u?.n).toBe(1);
    expect(model.requests[0]?.messages.at(-1)?.role).toBe("user");
    expect((await lastRun())?.billed_as).toBe("included");
  });

  test("full order across three turns", async () => {
    const model = new ScriptedAssistantModel([]);
    const item = { menu_item_id: a.menuItemId, size_id: a.menuItemSizeId, quantity: 2, notes: null };

    const t1 = await inbound("quero 2 marmitas");
    model.push(
      {
        tools: [
          { name: "update_cart", input: { items: [item], fulfillment: null, address: null, customer_name: null } },
        ],
      },
      { text: "Anotei! Retirada ou entrega?" },
    );
    await runAiTurn(deps, model, job(t1));

    const t2 = await inbound("retirada");
    model.push(
      {
        tools: [
          { name: "update_cart", input: { items: null, fulfillment: "pickup", address: null, customer_name: null } },
        ],
      },
      { tools: [{ name: "send_order_summary", input: {} }] },
      { text: "Posso confirmar?" },
    );
    await runAiTurn(deps, model, job(t2));

    const t3 = await inbound("sim");
    model.push({ tools: [{ name: "place_order", input: {} }] }, { text: "Pedido confirmado!" });
    const out = await runAiTurn(deps, model, job(t3));

    const [o] = await db<{ source: string; ai_run_id: string; payment_method: string | null }[]>`
      select source, ai_run_id, payment_method from public.orders where restaurant_id = ${a.restaurantId} and ai_run_id = ${out.runId}`;
    expect(o).toEqual({ source: "whatsapp", ai_run_id: out.runId, payment_method: null });
  });

  test("a burst: only the job of the latest inbound runs", async () => {
    const m1 = await inbound("quero");
    const m2 = await inbound("2 marmitas");
    const model = new ScriptedAssistantModel([{ text: "Certo!" }]);
    expect(await runAiTurn(deps, model, job(m1))).toMatchObject({ kind: "done", status: "superseded" });
    expect(await runAiTurn(deps, model, job(m2))).toMatchObject({ kind: "done", status: "replied" });
    expect(model.requests).toHaveLength(1);
  });

  test("paused, answered, stale, and locked stop before the model", async () => {
    const model = new ScriptedAssistantModel([]);
    const m = await inbound("oi");
    await db`update public.conversations set ai_mode = 'paused', ai_pause_reason = 'attendant' where id = ${a.conversationId}`;
    expect(await runAiTurn(deps, model, job(m))).toMatchObject({ status: "paused" });
    await db`update public.conversations set ai_mode = 'auto', ai_pause_reason = null where id = ${a.conversationId}`;

    expect(await runAiTurn(deps, model, job(m, new Date(t - 121_000)))).toMatchObject({ status: "stale" });
    const [s] = await db<
      { ai_pause_reason: string }[]
    >`select ai_pause_reason from public.conversations where id = ${a.conversationId}`;
    expect(s?.ai_pause_reason).toBe("stale");
    await db`update public.conversations set ai_mode = 'auto', ai_pause_reason = null where id = ${a.conversationId}`;

    await db`update public.conversations set ai_turn_claimed_at = ${new Date(t)} where id = ${a.conversationId}`;
    expect(await runAiTurn(deps, model, job(m))).toMatchObject({ status: "locked" });
    const [q] = await db<{ n: number }[]>`select count(*)::int as n from pgmq.q_mt_ai_turns`;
    expect(q?.n).toBe(1);
    await db`update public.conversations set ai_turn_claimed_at = null where id = ${a.conversationId}`;

    await db`insert into public.messages (restaurant_id, conversation_id, direction, body, status, sent_by, created_at)
             values (${a.restaurantId}, ${a.conversationId}, 'out', 'oi', 'sent', ${a.attendantId}, ${new Date(t + 1)})`;
    expect(await runAiTurn(deps, model, job(m))).toMatchObject({ status: "answered" });
    expect(model.requests).toHaveLength(0);
  });

  test("an automatic welcome after the trigger is not an answer", async () => {
    const m = await inbound("oi");
    await db`insert into public.messages (restaurant_id, conversation_id, direction, body, status, automatic_kind, created_at)
             values (${a.restaurantId}, ${a.conversationId}, 'out', 'Bem-vindo!', 'sent', 'welcome', ${new Date(t + 1)})`;
    const model = new ScriptedAssistantModel([{ text: "Oi! O que vai querer?" }]);
    expect(await runAiTurn(deps, model, job(m))).toMatchObject({ kind: "done", status: "replied" });
    expect(model.requests).toHaveLength(1);
  });

  test("an empty history stops as silent before the model, with no usage and no claim", async () => {
    const m = await inbound("oi");
    // Twenty automatic messages after the trigger fill the history window with outbound rows only.
    for (let i = 1; i <= 20; i++) {
      await db`insert into public.messages (restaurant_id, conversation_id, direction, body, status, automatic_kind, created_at)
               values (${a.restaurantId}, ${a.conversationId}, 'out', 'aviso', 'sent', 'closed', ${new Date(t + i)})`;
    }
    const model = new ScriptedAssistantModel([]);
    const out = await runAiTurn(deps, model, job(m));
    expect(out).toMatchObject({ kind: "done", status: "silent" });
    expect(model.requests).toHaveLength(0);
    const [u] = await db<
      { n: number }[]
    >`select count(*)::int as n from public.usage_events where ref_id = ${out.runId}`;
    expect(u?.n).toBe(0);
    expect((await lastRun())?.model_calls).toBe(0);
    const [c] = await db<
      { ai_turn_claimed_at: Date | null }[]
    >`select ai_turn_claimed_at from public.conversations where id = ${a.conversationId}`;
    expect(c?.ai_turn_claimed_at).toBeNull();
    await db`delete from public.messages where conversation_id = ${a.conversationId} and automatic_kind = 'closed'`;
  });

  test("refusal sends nothing and pauses with model", async () => {
    const m = await inbound("x");
    const out = await runAiTurn(deps, new ScriptedAssistantModel([{ stop: "refusal" }]), job(m));
    expect(out).toMatchObject({ status: "stopped" });
    const [c] = await db<
      { ai_pause_reason: string }[]
    >`select ai_pause_reason from public.conversations where id = ${a.conversationId}`;
    expect(c?.ai_pause_reason).toBe("model");
  });

  test("six tool rounds without a reply stop the turn", async () => {
    const m = await inbound("x");
    const steps = Array.from({ length: 6 }, () => ({ tools: [{ name: "search_menu", input: { query: null } }] }));
    const out = await runAiTurn(deps, new ScriptedAssistantModel(steps), job(m));
    expect(out).toMatchObject({ status: "stopped" });
    expect((await lastRun())?.model_calls).toBe(6);
  });

  test("a retryable model error returns retry and clears the claim", async () => {
    const m = await inbound("x");
    const out = await runAiTurn(
      deps,
      new ScriptedAssistantModel([{ error: new AssistantModelError("busy", true, "overloaded") }]),
      job(m),
    );
    expect(out).toMatchObject({ kind: "retry", errorCode: "overloaded" });
    const [c] = await db<
      { ai_turn_claimed_at: Date | null }[]
    >`select ai_turn_claimed_at from public.conversations where id = ${a.conversationId}`;
    expect(c?.ai_turn_claimed_at).toBeNull();
  });

  test("an attendant reply during the loop drops the AI reply", async () => {
    const m = await inbound("oi");
    const model = new ScriptedAssistantModel([{ text: "Oi!" }]);
    const original = model.respond.bind(model);
    spyOn(model, "respond").mockImplementation(async (req) => {
      await db`update public.conversations set ai_mode = 'paused', ai_pause_reason = 'attendant' where id = ${a.conversationId}`;
      return original(req);
    });
    expect(await runAiTurn(deps, model, job(m))).toMatchObject({ status: "silent" });
  });

  test("logs and ai_runs hold no customer text", async () => {
    const m = await inbound("meu cpf é 123.456.789-00");
    const logs: string[] = [];
    const spy = spyOn(console, "log").mockImplementation((...args) => void logs.push(args.join(" ")));
    await runAiTurn(deps, new ScriptedAssistantModel([{ text: "Ok" }]), job(m));
    spy.mockRestore();
    const [r] = await db<
      { row: string }[]
    >`select to_jsonb(r)::text as row from public.ai_runs r order by started_at desc limit 1`;
    expect(r?.row).not.toContain("123.456");
    expect(logs.join("\n")).not.toContain("123.456");
  });
});
