// covers FR-180, FR-194, FR-196, FR-197, FR-213
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AppError } from "@mt/core";
import type { Db } from "@mt/db";
import { createTestDb, type RestaurantFixture, seedRestaurant } from "@mt/db/test-harness";

import type { ServiceDeps } from "../../deps";
import { createTestServiceDeps, userCtx } from "../../testing";
import { getPlanAndUsage } from "../admin/plan";
import { getAiSettings, saveAiSettings } from "./settings";

let db: Db;
let deps: ServiceDeps;
let a: RestaurantFixture;
const admin = () => userCtx(a.restaurantId, a.adminId, "admin");
const settings = {
  enabled: true,
  personaName: "Ana",
  extraInstructions: null,
  autoResumeMinutes: 60,
  allowOverage: false,
  monthlyHardCap: 20000,
  autoConfirmOrders: false,
};

async function addReplies(n: number): Promise<void> {
  await db`insert into public.usage_events (restaurant_id, kind, ref_id, occurred_at)
           select ${a.restaurantId}, 'ai.reply', gen_random_uuid(), '2026-10-13T12:00:00Z' from generate_series(1, ${n})`;
}

beforeAll(async () => {
  db = await createTestDb();
  deps = createTestServiceDeps(db);
  a = await seedRestaurant(db, "ai-set-a");
  await db`update public.restaurants set plan_code = 'free' where id = ${a.restaurantId}`;
});
afterAll(async () => db.end());

describe("AI settings", () => {
  test("defaults: off", async () => {
    const s = await getAiSettings(deps, admin(), undefined);
    expect(s).toMatchObject({
      enabled: false,
      personaName: "Atendente",
      autoResumeMinutes: 360,
      allowOverage: false,
      monthlyHardCap: 20000,
      autoConfirmOrders: false,
    });
    expect(s.quota).toMatchObject({ state: "included", used: 0, included: 300 });
  });
  test("an attendant cannot save", async () => {
    const e = await saveAiSettings(deps, userCtx(a.restaurantId, a.attendantId, "attendant"), settings).catch((x) => x);
    expect(e instanceof AppError ? e.code : String(e)).toBe("forbidden");
  });
  test("admin saves; quota blocks at 300 without overage and allows with it", async () => {
    await saveAiSettings(deps, admin(), settings);
    await addReplies(300);
    expect((await getAiSettings(deps, admin(), undefined)).quota.state).toBe("blocked_quota");
    await saveAiSettings(deps, admin(), { ...settings, allowOverage: true });
    await addReplies(150);
    const q = (await getAiSettings(deps, admin(), undefined)).quota;
    expect(q).toMatchObject({ state: "overage", used: 450, extra: 150, amountCents: 1000 });
  });
  test("admin turns on auto-confirm (FR-213)", async () => {
    await saveAiSettings(deps, admin(), { ...settings, allowOverage: true, autoConfirmOrders: true });
    expect((await getAiSettings(deps, admin(), undefined)).autoConfirmOrders).toBe(true);
  });
  test("the plan tab shows AI replies", async () => {
    const plan = await getPlanAndUsage(deps, admin(), undefined);
    expect(plan.usage.aiReplies).toMatchObject({
      used: 450,
      included: 300,
      extra: 150,
      amountCents: 1000,
      allowOverage: true,
    });
  });
});
