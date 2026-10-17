// covers FR-180, FR-188, FR-194, FR-195, NFR-001
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Db } from "@mt/db";
import {
  asService,
  CHECK_VIOLATION,
  createTestDb,
  errorCode,
  type RestaurantFixture,
  seedRestaurant,
} from "@mt/db/test-harness";

let db: Db;
let a: RestaurantFixture;
let b: RestaurantFixture;
const sys = (r: RestaurantFixture) => ({ restaurantId: r.restaurantId, actorType: "system" as const });

beforeAll(async () => {
  db = await createTestDb();
  a = await seedRestaurant(db, "ai-a");
  b = await seedRestaurant(db, "ai-b");
});
afterAll(async () => db.end());

describe("migration 0020", () => {
  test("plans carry the seed AI quota and price", async () => {
    const rows = await db<{ code: string; included_ai_replies_month: number; ai_overage_price_cents: string }[]>`
      select code, included_ai_replies_month, ai_overage_price_cents from public.plans order by code`;
    expect(rows.map((r) => [r.code, r.included_ai_replies_month, Number(r.ai_overage_price_cents)])).toEqual([
      ["free", 300, 500],
      ["pro", 3000, 500],
    ]);
  });

  test("a conversation starts with ai_mode auto", async () => {
    const [c] = await db<
      { ai_mode: string }[]
    >`select ai_mode from public.conversations where id = ${a.conversationId}`;
    expect(c?.ai_mode).toBe("auto");
  });

  test("orders accept a null payment method", async () => {
    await db`update public.orders set payment_method = null where id = ${a.orderId}`;
    const [o] = await db<
      { payment_method: string | null }[]
    >`select payment_method from public.orders where id = ${a.orderId}`;
    expect(o?.payment_method).toBeNull();
    await db`update public.orders set payment_method = 'pix' where id = ${a.orderId}`;
  });

  test("usage_events accepts ai.reply", async () => {
    const id = crypto.randomUUID();
    await db`insert into public.usage_events (restaurant_id, kind, ref_id) values (${a.restaurantId}, 'ai.reply', ${id})`;
    const [u] = await db<{ n: number }[]>`select count(*)::int as n from public.usage_events where ref_id = ${id}`;
    expect(u?.n).toBe(1);
  });

  test("an unknown pause reason is refused", async () => {
    const code = await errorCode(
      () => db`update public.conversations set ai_pause_reason = 'bored' where id = ${a.conversationId}`,
    );
    expect(code).toBe(CHECK_VIOLATION);
  });

  test("one open cart per conversation", async () => {
    await db`insert into public.ai_carts (restaurant_id, conversation_id) values (${a.restaurantId}, ${a.conversationId})`;
    const code = await errorCode(
      () =>
        db`insert into public.ai_carts (restaurant_id, conversation_id) values (${a.restaurantId}, ${a.conversationId})`,
    );
    expect(code).toBe("23505");
  });

  test("RLS: restaurant B sees no AI row of restaurant A", async () => {
    await db`insert into public.ai_settings (restaurant_id, enabled) values (${a.restaurantId}, true)
             on conflict (restaurant_id) do update set enabled = true`;
    await db`insert into public.ai_runs (restaurant_id, conversation_id, trigger_message_id, status)
             values (${a.restaurantId}, ${a.conversationId}, ${a.messageId}, 'replied')`;
    const seen = await asService(db, sys(b), async (tx) => ({
      settings: (await tx`select 1 from public.ai_settings where restaurant_id = ${a.restaurantId}`).length,
      carts: (await tx`select 1 from public.ai_carts where restaurant_id = ${a.restaurantId}`).length,
      runs: (await tx`select 1 from public.ai_runs where restaurant_id = ${a.restaurantId}`).length,
    }));
    expect(seen).toEqual({ settings: 0, carts: 0, runs: 0 });
  });

  test("the mt_ai_turns queue exists", async () => {
    const [q] = await db<{ n: number }[]>`select count(*)::int as n from pgmq.meta where queue_name = 'mt_ai_turns'`;
    expect(q?.n).toBe(1);
  });
});
