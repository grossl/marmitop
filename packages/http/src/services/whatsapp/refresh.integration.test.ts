// covers FR-174, FR-107 (ADR-042): "Atualizar" enqueues one timestamp poll for the caller's restaurant.
// Needs the local stack (`bun run dev:stack`) or TEST_DATABASE_URL.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Db } from "@mt/db";
import { createTestDb, type RestaurantFixture, seedRestaurant, truncateQueues } from "@mt/db/test-harness";

import { createTestServiceDeps, userCtx } from "../../testing";
import { refreshWhatsApp, refreshWhatsAppText } from "./refresh";

let db: Db;
let a: RestaurantFixture;
let b: RestaurantFixture;

const queued = async () => {
  const rows = await db<{ message: Record<string, unknown> }[]>`select message from pgmq.q_mt_sync order by msg_id`;
  return rows.map((r) => r.message);
};

beforeAll(async () => {
  db = await createTestDb();
  a = await seedRestaurant(db, "refresh-a");
  b = await seedRestaurant(db, "refresh-b");
});

beforeEach(async () => {
  await truncateQueues(db);
});

afterAll(async () => {
  await db.end();
});

describe("refreshWhatsApp", () => {
  test("an attendant enqueues one whatsapp_reconcile job, and a second press waits for it", async () => {
    const deps = createTestServiceDeps(db);
    const ctx = userCtx(a.restaurantId, a.attendantId, "attendant");
    expect(await refreshWhatsApp(deps, ctx, undefined)).toEqual({ result: "enqueued" });
    expect(await refreshWhatsApp(deps, ctx, undefined)).toEqual({ result: "already_queued" });
    expect(await queued()).toEqual([{ v: 1, restaurantId: a.restaurantId, op: "whatsapp_reconcile" }]);
  });

  test("restaurant B's admin never enqueues for restaurant A", async () => {
    const deps = createTestServiceDeps(db);
    expect(await refreshWhatsApp(deps, userCtx(b.restaurantId, b.adminId, "admin"), undefined)).toEqual({
      result: "enqueued",
    });
    expect(await queued()).toEqual([{ v: 1, restaurantId: b.restaurantId, op: "whatsapp_reconcile" }]);
  });

  test("a disconnected integration enqueues nothing", async () => {
    await db`update public.integrations_whatsapp set status = 'disconnected' where restaurant_id = ${b.restaurantId}`;
    try {
      const deps = createTestServiceDeps(db);
      expect(await refreshWhatsApp(deps, userCtx(b.restaurantId, b.adminId, "admin"), undefined)).toEqual({
        result: "not_connected",
      });
      expect(await queued()).toEqual([]);
    } finally {
      await db`update public.integrations_whatsapp set status = 'connected' where restaurant_id = ${b.restaurantId}`;
    }
  });

  test("each result has pt-BR text", () => {
    expect(refreshWhatsAppText("enqueued")).toBe("Buscando mensagens no WhatsApp…");
    expect(refreshWhatsAppText("already_queued")).toBe("Uma atualização já está em andamento.");
    expect(refreshWhatsAppText("not_connected")).toBe("O WhatsApp não está conectado.");
  });
});
