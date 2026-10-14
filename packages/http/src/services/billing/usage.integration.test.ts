// covers FR-152, FR-156 (usage metering under the attendant and API-key roles)
//
// Regression: `insert ... on conflict (kind, ref_id) do nothing` makes Postgres
// check the new row against the SELECT policy too. usage_events is admin-read
// only, so attendants and API keys (actor role `attendant`) failed with 42501
// and every createOrder from those roles rolled back.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Db } from "@mt/db";
import { asService, createTestDb, type RestaurantFixture, seedRestaurant } from "@mt/db/test-harness";

import { recordUsage } from "./usage";

let db: Db;
let a: RestaurantFixture;

beforeAll(async () => {
  db = await createTestDb();
  a = await seedRestaurant(db, "usage-a");
});

afterAll(async () => {
  await db.end();
});

describe("recordUsage", () => {
  test("an attendant records usage, and a repeat does not count twice", async () => {
    const ref = crypto.randomUUID();
    await asService(db, a.attendantCtx, (tx) => recordUsage(tx, a.restaurantId, "order.created", ref));
    await asService(db, a.attendantCtx, (tx) => recordUsage(tx, a.restaurantId, "order.created", ref));
    const rows = await db`select kind from public.usage_events where ref_id = ${ref}`;
    expect(rows).toHaveLength(1);
  });

  test("an API key records usage", async () => {
    const ref = crypto.randomUUID();
    await asService(db, a.apiKeyCtx, (tx) => recordUsage(tx, a.restaurantId, "order.created", ref));
    const rows = await db`select kind from public.usage_events where ref_id = ${ref}`;
    expect(rows).toHaveLength(1);
  });
});
