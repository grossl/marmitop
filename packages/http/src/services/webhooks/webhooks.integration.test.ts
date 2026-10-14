// covers FR-039, FR-146, FR-148, FR-149, FR-152, ADR-007 (enqueue in the same transaction), ADR-008, ADR-009
// Needs the local stack (`bun run dev:stack`) or TEST_DATABASE_URL.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { AppError } from "@mt/core";
import { type Db, type Tx, withRestaurantContext } from "@mt/db";
import { createTestDb, type RestaurantFixture, seedRestaurant, truncateQueues } from "@mt/db/test-harness";

import { toDbContext } from "../../context";
import type { ServiceDeps } from "../../deps";
import { createTestServiceDeps, userCtx } from "../../testing";
import { rotateWebhookSecret, saveWebhookEndpoint } from "../admin/integrations";
import { recordUsage } from "../billing/usage";
import { simulateInboundMessage } from "../messaging/simulate-inbound";
import { changeOrderStatus } from "../orders/change-status";
import { createOrder } from "../orders/create-order";
import { systemCtx } from "../whatsapp/connection";
import {
  listWebhookDeliveries,
  loadDeliveryForSend,
  markDeliveryExhausted,
  recordDeliveryAttempt,
  redeliverWebhook,
} from "./deliveries";
import { emitEvent } from "./emit";

let db: Db;
let deps: ServiceDeps;
let a: RestaurantFixture;
let b: RestaurantFixture;
let secret: string;

const admin = () => userCtx(a.restaurantId, a.adminId, "admin");
const att = () => userCtx(a.restaurantId, a.attendantId, "attendant");
/** Service-path transactions: `app_service`, so RLS applies as in production. */
const asAtt = <T>(fn: (tx: Tx) => Promise<T>) => withRestaurantContext(db, toDbContext(att()), fn, deps.contextOptions);
const asSys = <T>(fn: (tx: Tx) => Promise<T>) =>
  withRestaurantContext(db, toDbContext(systemCtx(a.restaurantId)), fn, deps.contextOptions);
const code = (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`);

async function deliveries(restaurantId: string) {
  return db<
    { id: string; event: string; status: string; payload: Record<string, unknown>; next_attempt_at: Date | null }[]
  >`
    select id, event, status, payload, next_attempt_at from public.webhook_deliveries
    where restaurant_id = ${restaurantId} order by created_at, id`;
}

async function jobs() {
  return db<{ message: { restaurantId: string; deliveryId: string } }[]>`
    select message from pgmq.q_mt_webhook_deliveries order by msg_id`;
}

const subscribeAll = (enabled = true) =>
  saveWebhookEndpoint(deps, admin(), {
    url: "https://hooks.example.com/marmitop",
    events: ["order.created", "order.status_changed", "message.received", "invoice.updated"],
    enabled,
  });

beforeAll(async () => {
  db = await createTestDb();
  deps = createTestServiceDeps(db);
  a = await seedRestaurant(db, "wh-a");
  b = await seedRestaurant(db, "wh-b");
  await subscribeAll();
  secret = (await rotateWebhookSecret(deps, admin(), undefined)).secret;
});

beforeEach(async () => {
  await truncateQueues(db);
  await db`delete from public.webhook_deliveries`;
});

afterAll(async () => {
  await db.end();
});

const orderInput = () => ({
  customerId: a.customerId,
  items: [{ menuItemId: a.menuItemId, sizeId: a.menuItemSizeId, qty: 1 }],
  fulfillment: "pickup" as const,
  paymentMethod: "pix" as const,
  source: "counter" as const,
});

describe("emitEvent", () => {
  test("writes one pending delivery with the 06 envelope and enqueues its job", async () => {
    const ids = await asAtt((tx) => emitEvent(tx, a.restaurantId, "invoice.updated", { invoice: { id: "x" } }));
    expect(ids).toHaveLength(1);
    const [row] = await deliveries(a.restaurantId);
    expect(row).toMatchObject({ id: ids[0], event: "invoice.updated", status: "pending" });
    expect(row?.payload).toMatchObject({
      id: ids[0],
      type: "invoice.updated",
      restaurant_id: a.restaurantId,
      data: { invoice: { id: "x" } },
    });
    expect(row?.next_attempt_at).not.toBeNull();
    expect((await jobs()).map((j) => j.message)).toEqual([
      expect.objectContaining({ v: 1, restaurantId: a.restaurantId, deliveryId: ids[0] }),
    ]);
  });

  test("an event the endpoint does not subscribe to, or a disabled endpoint, emits nothing", async () => {
    await saveWebhookEndpoint(deps, admin(), {
      url: "https://hooks.example.com/marmitop",
      events: ["order.created"],
      enabled: true,
    });
    await asAtt((tx) => emitEvent(tx, a.restaurantId, "message.received", {}));
    await subscribeAll(false);
    await asAtt((tx) => emitEvent(tx, a.restaurantId, "order.created", {}));
    expect(await deliveries(a.restaurantId)).toHaveLength(0);
    expect(await jobs()).toHaveLength(0);
    await subscribeAll();
  });

  test("a rollback drops the delivery and the job (same transaction)", async () => {
    await asAtt(async (tx) => {
      await emitEvent(tx, a.restaurantId, "order.created", {});
      throw new Error("rollback");
    }).catch(() => undefined);
    expect(await deliveries(a.restaurantId)).toHaveLength(0);
    expect(await jobs()).toHaveLength(0);
  });

  test("an API-key actor can emit (attendant insert, no read of deliveries)", async () => {
    const ctx = {
      restaurantId: a.restaurantId,
      actorType: "api_key" as const,
      apiKeyId: a.apiKeyId,
      role: "attendant" as const,
    };
    await withRestaurantContext(
      db,
      toDbContext(ctx),
      (tx) => emitEvent(tx, a.restaurantId, "order.created", {}),
      deps.contextOptions,
    );
    expect(await deliveries(a.restaurantId)).toHaveLength(1);
  });
});

describe("producers", () => {
  test("createOrder emits order.created with the Order object and records usage (FR-039, FR-152)", async () => {
    const created = await createOrder(deps, att(), orderInput());
    const [row] = await deliveries(a.restaurantId);
    expect(row?.event).toBe("order.created");
    expect(row?.payload.data).toMatchObject({
      order: { id: created.id, code: created.code, source: "counter", total_cents: created.totalCents },
    });
    const usage = await db`select kind from public.usage_events where ref_id = ${created.id}`;
    expect([...usage]).toEqual([{ kind: "order.created" }]);
    // restaurant B saw nothing
    expect(await deliveries(b.restaurantId)).toHaveLength(0);
  });

  test("changeOrderStatus emits order.status_changed with from and to", async () => {
    const created = await createOrder(deps, att(), orderInput());
    await changeOrderStatus(deps, att(), { orderId: created.id, toStatus: "confirmado" });
    const rows = await deliveries(a.restaurantId);
    const changed = rows.find((r) => r.event === "order.status_changed");
    expect(changed?.payload.data).toMatchObject({
      order_id: created.id,
      code: created.code,
      from_status: "aguardando",
      to_status: "confirmado",
    });
  });

  test("a no-op status move emits nothing", async () => {
    const created = await createOrder(deps, att(), orderInput());
    await changeOrderStatus(deps, att(), { orderId: created.id, toStatus: "aguardando" });
    const rows = await deliveries(a.restaurantId);
    expect(rows.filter((r) => r.event === "order.status_changed")).toHaveLength(0);
  });

  test("an inbound message emits message.received once; a replay emits nothing", async () => {
    await simulateInboundMessage(deps, admin(), { phone: "+5511912345678", body: "Oi" });
    const rows = (await deliveries(a.restaurantId)).filter((r) => r.event === "message.received");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload.data).toMatchObject({
      message: { body: "Oi" },
      customer: { phone: "+5511912345678" },
    });
  });
});

describe("worker loaders", () => {
  test("loadDeliveryForSend unseals the endpoint secret and returns the stored body", async () => {
    const [id] = await asAtt((tx) => emitEvent(tx, a.restaurantId, "order.created", { order: { id: "o" } }));
    const loaded = await asSys((tx) => loadDeliveryForSend(tx, deps, a.restaurantId, id as string));
    expect(loaded?.endpoint).toEqual({ url: "https://hooks.example.com/marmitop", enabled: true, secret });
    expect(JSON.parse(loaded?.body ?? "{}")).toMatchObject({ id, type: "order.created", data: { order: { id: "o" } } });
  });

  test("recordDeliveryAttempt and markDeliveryExhausted update the row; a delivered row stays delivered", async () => {
    const [id] = await asAtt((tx) => emitEvent(tx, a.restaurantId, "order.created", {}));
    const at = new Date("2026-10-13T15:00:00Z");
    await asSys((tx) =>
      recordDeliveryAttempt(tx, a.restaurantId, id as string, {
        attemptNo: 1,
        status: "failed",
        statusCode: 500,
        error: "http_500",
        nextAttemptAt: new Date(at.getTime() + 60_000),
        at,
      }),
    );
    let [row] =
      await db`select status, attempts, last_status_code, last_error from public.webhook_deliveries where id = ${id as string}`;
    expect(row).toEqual({ status: "failed", attempts: 1, last_status_code: 500, last_error: "http_500" });
    await asSys((tx) =>
      recordDeliveryAttempt(tx, a.restaurantId, id as string, {
        attemptNo: 2,
        status: "delivered",
        statusCode: 200,
        error: null,
        nextAttemptAt: null,
        at,
      }),
    );
    await asSys((tx) => markDeliveryExhausted(tx, a.restaurantId, id as string, "x"));
    [row] = await db`select status, attempts, delivered_at from public.webhook_deliveries where id = ${id as string}`;
    expect(row).toMatchObject({ status: "delivered", attempts: 2 });
    expect(row?.delivered_at).not.toBeNull();
  });
});

describe("settings: deliveries (FR-149)", () => {
  test("the admin lists recent deliveries; an attendant is refused", async () => {
    await asAtt((tx) => emitEvent(tx, a.restaurantId, "order.created", {}));
    const list = await listWebhookDeliveries(deps, admin(), undefined);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ event: "order.created", status: "pending", attempts: 0 });
    expect(code(await listWebhookDeliveries(deps, att(), undefined).catch((e) => e))).toBe("forbidden");
    expect(await listWebhookDeliveries(deps, userCtx(b.restaurantId, b.adminId, "admin"), undefined)).toHaveLength(0);
  });

  test("redeliver resets an exhausted delivery to pending and enqueues it; a pending one is 409", async () => {
    const [id] = await asAtt((tx) => emitEvent(tx, a.restaurantId, "order.created", {}));
    expect(code(await redeliverWebhook(deps, admin(), { deliveryId: id as string }).catch((e) => e))).toBe("conflict");
    await db`update public.webhook_deliveries set status = 'exhausted', attempts = 6 where id = ${id as string}`;
    await truncateQueues(db);
    await redeliverWebhook(deps, admin(), { deliveryId: id as string });
    const [row] = await db`select status, attempts from public.webhook_deliveries where id = ${id as string}`;
    expect(row).toEqual({ status: "pending", attempts: 0 });
    expect(await jobs()).toHaveLength(1);
  });

  test("redeliver of another restaurant's delivery is 404", async () => {
    const [id] = await asAtt((tx) => emitEvent(tx, a.restaurantId, "order.created", {}));
    const e = await redeliverWebhook(deps, userCtx(b.restaurantId, b.adminId, "admin"), {
      deliveryId: id as string,
    }).catch((x) => x);
    expect(code(e)).toBe("not_found");
  });
});

describe("recordUsage (FR-152)", () => {
  test("is idempotent per (kind, ref_id)", async () => {
    const ref = crypto.randomUUID();
    for (let i = 0; i < 2; i++) {
      await asAtt((tx) => recordUsage(tx, a.restaurantId, "invoice.issued", ref));
    }
    expect(await db`select 1 from public.usage_events where ref_id = ${ref}`).toHaveLength(1);
  });
});
