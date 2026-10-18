// covers FR-181, FR-189, FR-190, FR-196
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Db } from "@mt/db";
import { createTestDb, type RestaurantFixture, seedRestaurant, truncateQueues } from "@mt/db/test-harness";

import type { ServiceDeps } from "../../deps";
import { createTestServiceDeps, userCtx } from "../../testing";
import { listConversations, sendMessage, simulateInboundMessage } from "../messaging";
import { setConversationAiMode } from "./conversation-mode";

let db: Db;
let deps: ServiceDeps;
let a: RestaurantFixture;
const admin = () => userCtx(a.restaurantId, a.adminId, "admin");
const attendant = () => userCtx(a.restaurantId, a.attendantId, "attendant");

async function aiJobs(): Promise<{ conversationId: string }[]> {
  const rows = await db<{ message: { conversationId: string } }[]>`select message from pgmq.q_mt_ai_turns`;
  return rows.map((r) => r.message);
}

beforeAll(async () => {
  db = await createTestDb();
  deps = createTestServiceDeps(db);
  a = await seedRestaurant(db, "trig-a");
  // The seed opens Monday only. Open every weekday all day.
  for (let weekday = 0; weekday <= 6; weekday++) {
    await db`insert into public.business_hours (restaurant_id, weekday, enabled, opens_at, closes_at)
             values (${a.restaurantId}, ${weekday}, true, '00:00', '23:59')
             on conflict (restaurant_id, weekday) do update set enabled = true, opens_at = '00:00', closes_at = '23:59'`;
  }
  await db`update public.restaurants set plan_code = 'free' where id = ${a.restaurantId}`;
});
beforeEach(async () => {
  await truncateQueues(db);
  await db`insert into public.ai_settings (restaurant_id, enabled) values (${a.restaurantId}, true)
           on conflict (restaurant_id) do update set enabled = true, allow_overage = false`;
  await db`update public.conversations set ai_mode = 'auto', ai_pause_reason = null, ai_paused_at = null where restaurant_id = ${a.restaurantId}`;
  await db`delete from public.usage_events where restaurant_id = ${a.restaurantId} and kind = 'ai.reply'`;
});
afterAll(async () => db.end());

describe("enqueueAiTurn through the inbound path", () => {
  test("one job with the trigger message", async () => {
    const r = await simulateInboundMessage(deps, admin(), { phone: "+5511911112222", body: "oi" });
    const jobs = await aiJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ conversationId: r.conversationId, triggerMessageId: r.messageId });
  });
  test("assistant off → no job", async () => {
    await db`update public.ai_settings set enabled = false where restaurant_id = ${a.restaurantId}`;
    await simulateInboundMessage(deps, admin(), { phone: "+5511911112223", body: "oi" });
    expect(await aiJobs()).toHaveLength(0);
  });
  test("restaurant closed → no job", async () => {
    await db`update public.business_hours set enabled = false where restaurant_id = ${a.restaurantId}`;
    await simulateInboundMessage(deps, admin(), { phone: "+5511911112224", body: "oi" });
    expect(await aiJobs()).toHaveLength(0);
    await db`update public.business_hours set enabled = true where restaurant_id = ${a.restaurantId}`;
  });
  test("quota used and overage off → no job, conversation paused with quota", async () => {
    await db`insert into public.usage_events (restaurant_id, kind, ref_id, occurred_at)
             select ${a.restaurantId}, 'ai.reply', gen_random_uuid(), '2026-10-13T12:00:00Z' from generate_series(1, 300)`;
    const r = await simulateInboundMessage(deps, admin(), { phone: "+5511911112225", body: "oi" });
    expect(await aiJobs()).toHaveLength(0);
    const [c] = await db<{ ai_mode: string; ai_pause_reason: string }[]>`
      select ai_mode, ai_pause_reason from public.conversations where id = ${r.conversationId}`;
    expect(c).toEqual({ ai_mode: "paused", ai_pause_reason: "quota" });
  });
});

describe("attendant pause", () => {
  test("an attendant reply pauses the assistant; the next inbound gives no job", async () => {
    const first = await simulateInboundMessage(deps, admin(), { phone: "+5511911112226", body: "oi" });
    await truncateQueues(db);
    await sendMessage(deps, attendant(), { conversationId: first.conversationId, body: "Olá! Já te atendo." });
    const [c] = await db<{ ai_mode: string; ai_pause_reason: string }[]>`
      select ai_mode, ai_pause_reason from public.conversations where id = ${first.conversationId}`;
    expect(c).toEqual({ ai_mode: "paused", ai_pause_reason: "attendant" });
    await simulateInboundMessage(deps, admin(), { phone: "+5511911112226", body: "e aí?" });
    expect(await aiJobs()).toHaveLength(0);
  });
  test("after auto_resume_minutes the next inbound resumes and enqueues", async () => {
    const first = await simulateInboundMessage(deps, admin(), { phone: "+5511911112227", body: "oi" });
    await db`update public.conversations set ai_mode = 'paused', ai_pause_reason = 'attendant',
             ai_paused_at = '2026-10-13T08:00:00Z' where id = ${first.conversationId}`;
    await truncateQueues(db);
    await simulateInboundMessage(deps, admin(), { phone: "+5511911112227", body: "oi de novo" });
    expect(await aiJobs()).toHaveLength(1);
    const [c] = await db<
      { ai_mode: string }[]
    >`select ai_mode from public.conversations where id = ${first.conversationId}`;
    expect(c?.ai_mode).toBe("auto");
  });
});

describe("setConversationAiMode and the needsAttendant filter", () => {
  test("Retomar sets auto; Pausar sets paused with reason manual", async () => {
    const r = await simulateInboundMessage(deps, admin(), { phone: "+5511911112228", body: "oi" });
    await setConversationAiMode(deps, attendant(), { conversationId: r.conversationId, mode: "paused" });
    const [p] = await db<
      { ai_pause_reason: string }[]
    >`select ai_pause_reason from public.conversations where id = ${r.conversationId}`;
    expect(p?.ai_pause_reason).toBe("manual");
    expect(await setConversationAiMode(deps, attendant(), { conversationId: r.conversationId, mode: "auto" })).toEqual({
      aiMode: "auto",
    });
  });
  test("needsAttendant lists handoffs, not attendant or manual pauses", async () => {
    const h = await simulateInboundMessage(deps, admin(), { phone: "+5511911112229", body: "oi" });
    await db`update public.conversations set ai_mode = 'paused', ai_pause_reason = 'complaint', ai_paused_at = now() where id = ${h.conversationId}`;
    const m = await simulateInboundMessage(deps, admin(), { phone: "+5511911112230", body: "oi" });
    await db`update public.conversations set ai_mode = 'paused', ai_pause_reason = 'manual', ai_paused_at = now() where id = ${m.conversationId}`;
    const list = await listConversations(deps, attendant(), { needsAttendant: true });
    const ids = list.items.map((c) => c.id);
    expect(ids).toContain(h.conversationId);
    expect(ids).not.toContain(m.conversationId);
  });
});
