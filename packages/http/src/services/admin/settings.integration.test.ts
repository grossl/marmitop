// covers FR-081, FR-082, FR-083, FR-084, FR-092, FR-093, FR-096, FR-098, FR-150, FR-151, FR-154, FR-155
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AppError } from "@mt/core";
import type { Db } from "@mt/db";
import { createTestDb, type RestaurantFixture, seedRestaurant } from "@mt/db/test-harness";

import type { ServiceDeps } from "../../deps";
import { createTestServiceDeps, userCtx } from "../../testing";
import { getPlanAndUsage } from "./plan";
import { getSettings, saveAutomaticMessage, saveBusinessHours, saveOrderPreferences } from "./settings";

let db: Db;
let deps: ServiceDeps;
let a: RestaurantFixture;
let b: RestaurantFixture;

const code = (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`);
const admin = () => userCtx(a.restaurantId, a.adminId, "admin");
const attendant = () => userCtx(a.restaurantId, a.attendantId, "attendant");

beforeAll(async () => {
  db = await createTestDb();
  deps = createTestServiceDeps(db);
  a = await seedRestaurant(db, "settings-a");
  b = await seedRestaurant(db, "settings-b");
});

afterAll(async () => {
  await db.end();
});

describe("getSettings", () => {
  test("returns profile, preferences, seven hour rows, three messages, and secret states without plaintext", async () => {
    const s = await getSettings(deps, admin(), undefined);
    expect(s.profile.id).toBe(a.restaurantId);
    expect(s.hours).toHaveLength(7);
    expect(s.hours[1]).toMatchObject({ weekday: 1, enabled: true, opensAt: "08:00", closesAt: "18:00" });
    expect(s.automaticMessages.map((m) => m.kind)).toEqual(["welcome", "closed", "order_received"]);
    expect(s.integrations.whatsapp?.apiKey).toEqual({ configured: true, last4: "abcd" });
    expect(s.integrations.webhook?.secret.configured).toBe(true);
    const json = JSON.stringify(s);
    expect(json).not.toContain("ciphertext");
    expect(json).not.toContain("wrapped");
    expect(json).not.toMatch(/mtk_(live|test)_[0-9A-Za-z]{32}/);
  });

  test("an attendant is refused", async () => {
    expect(code(await getSettings(deps, attendant(), undefined).catch((e) => e))).toBe("forbidden");
  });
});

describe("saveOrderPreferences", () => {
  const input = {
    autoAccept: true,
    pickupEnabled: false,
    showDeliveryEstimate: false,
    deliveryFeeCents: 700,
    deliveryEstimateMinutes: 60,
    timezone: "America/Manaus",
  };

  test("an admin saves, and B is untouched", async () => {
    const saved = await saveOrderPreferences(deps, admin(), input);
    expect(saved).toMatchObject({ autoAccept: true, deliveryFeeCents: 700, timezone: "America/Manaus" });
    const [row] = await db<{ delivery_fee_cents: number }[]>`
      select delivery_fee_cents from public.restaurant_settings where restaurant_id = ${a.restaurantId}`;
    expect(row?.delivery_fee_cents).toBe(700);
    const [other] = await db<{ delivery_fee_cents: number; auto_accept: boolean }[]>`
      select delivery_fee_cents, auto_accept from public.restaurant_settings where restaurant_id = ${b.restaurantId}`;
    expect(other).toEqual({ delivery_fee_cents: 0, auto_accept: false });
  });

  test("an attendant is refused", async () => {
    expect(code(await saveOrderPreferences(deps, attendant(), input).catch((e) => e))).toBe("forbidden");
  });

  test("an unknown timezone and an out-of-range estimate are validation errors", async () => {
    const e = await saveOrderPreferences(deps, admin(), { ...input, timezone: "Mars/Base", deliveryEstimateMinutes: 1 }).catch(
      (x) => x,
    );
    expect(code(e)).toBe("validation_failed");
    expect((e as AppError).details?.map((d) => d.path)).toEqual(expect.arrayContaining(["timezone", "deliveryEstimateMinutes"]));
  });

  test("a forged admin role is stopped by RLS and writes nothing", async () => {
    const e = await saveOrderPreferences(deps, userCtx(a.restaurantId, a.attendantId, "admin"), {
      ...input,
      deliveryFeeCents: 999,
    }).catch((x) => x);
    expect(e).toBeInstanceOf(Error);
    const [row] = await db<{ delivery_fee_cents: number }[]>`
      select delivery_fee_cents from public.restaurant_settings where restaurant_id = ${a.restaurantId}`;
    expect(row?.delivery_fee_cents).not.toBe(999);
  });
});

describe("saveBusinessHours", () => {
  const days = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    enabled: weekday !== 0,
    opensAt: "09:00",
    closesAt: weekday === 5 ? "02:00" : "17:30",
  }));

  test("saves one interval per day, including one past midnight", async () => {
    await saveBusinessHours(deps, admin(), { days });
    const s = await getSettings(deps, admin(), undefined);
    expect(s.hours[0]).toMatchObject({ enabled: false, opensAt: "09:00" });
    expect(s.hours[5]).toMatchObject({ opensAt: "09:00", closesAt: "02:00" });
  });

  test("six days, a repeated weekday, and equal times are refused", async () => {
    expect(code(await saveBusinessHours(deps, admin(), { days: days.slice(0, 6) }).catch((e) => e))).toBe("validation_failed");
    const dup = days.map((d, i) => (i === 6 ? { ...d, weekday: 0 } : d));
    expect(code(await saveBusinessHours(deps, admin(), { days: dup }).catch((e) => e))).toBe("validation_failed");
    const same = days.map((d, i) => (i === 2 ? { ...d, closesAt: d.opensAt } : d));
    expect(code(await saveBusinessHours(deps, admin(), { days: same }).catch((e) => e))).toBe("validation_failed");
  });

  test("an attendant is refused", async () => {
    expect(code(await saveBusinessHours(deps, attendant(), { days }).catch((e) => e))).toBe("forbidden");
  });
});

describe("saveAutomaticMessage", () => {
  test("saves a body and a template for order_received", async () => {
    const saved = await saveAutomaticMessage(deps, admin(), {
      kind: "order_received",
      enabled: true,
      body: "Recebemos seu pedido!",
      templateName: "pedido_recebido",
      templateLanguage: "pt_BR",
    });
    expect(saved).toMatchObject({ templateName: "pedido_recebido", templateLanguage: "pt_BR" });
  });

  test("a template on welcome, or a name without a language, is refused", async () => {
    const t = await saveAutomaticMessage(deps, admin(), {
      kind: "welcome",
      enabled: true,
      body: "Oi",
      templateName: "x",
      templateLanguage: "pt_BR",
    }).catch((e) => e);
    expect(code(t)).toBe("validation_failed");
    const half = await saveAutomaticMessage(deps, admin(), {
      kind: "order_received",
      enabled: true,
      body: "Oi",
      templateName: "x",
    }).catch((e) => e);
    expect(code(half)).toBe("validation_failed");
  });

  test("an empty body is refused and an attendant is refused", async () => {
    expect(code(await saveAutomaticMessage(deps, admin(), { kind: "closed", enabled: true, body: " " }).catch((e) => e))).toBe(
      "validation_failed",
    );
    expect(code(await saveAutomaticMessage(deps, attendant(), { kind: "closed", enabled: true, body: "x" }).catch((e) => e))).toBe(
      "forbidden",
    );
  });
});

describe("getPlanAndUsage", () => {
  test("shows the plan, this month's usage, and an empty invoice history", async () => {
    // The fixture wrote one order.created event now(); the test clock is 2026-10-13. Add one inside the month.
    await db`
      insert into public.usage_events (restaurant_id, kind, ref_id, occurred_at)
      values (${a.restaurantId}, 'message.sent', gen_random_uuid(), '2026-10-05T12:00:00Z'),
             (${a.restaurantId}, 'message.sent', gen_random_uuid(), '2026-09-30T12:00:00Z')`;
    const p = await getPlanAndUsage(deps, admin(), undefined);
    expect(p.plan).toMatchObject({ code: "free", name: "Free", includedOrdersMonth: 300 });
    expect(p.usage.messages).toEqual({ used: 1, included: 1000 });
    expect(p.invoiceHistory).toEqual([]);
  });

  test("an attendant is refused", async () => {
    expect(code(await getPlanAndUsage(deps, attendant(), undefined).catch((e) => e))).toBe("forbidden");
  });
});
