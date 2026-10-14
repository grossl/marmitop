// covers FR-140, FR-141, FR-142, FR-143, FR-145, FR-008, NFR-002, ADR-017 (source api, attendant role)
// Needs the local stack (`bun run dev:stack`) or TEST_DATABASE_URL.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AppError, generateApiKey } from "@mt/core";
import type { Db } from "@mt/db";
import { createTestDb, type RestaurantFixture, seedRestaurant } from "@mt/db/test-harness";

import type { ApiKeyContext } from "../../context";
import type { ServiceDeps } from "../../deps";
import { createTestServiceDeps } from "../../testing";
import { createDbApiKeyDirectory } from "./api-keys";
import { apiCreateCustomer, apiGetCustomer, apiListCustomers, apiUpdateCustomer } from "./customers";
import { createDbIdempotencyStore } from "./idempotency";
import { apiListMenu } from "./menu";
import { apiSendMessage } from "./messages";
import { apiChangeOrderStatus, apiCreateOrder, apiGetOrder, apiListOrders } from "./orders";
import { createDbApiRateLimiter } from "./rate-limit";

let db: Db;
let deps: ServiceDeps;
let a: RestaurantFixture;
let b: RestaurantFixture;

const keyCtx = (f: RestaurantFixture): ApiKeyContext => ({
  restaurantId: f.restaurantId,
  actorType: "api_key",
  apiKeyId: f.apiKeyId,
  role: "attendant",
});
const code = (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`);

beforeAll(async () => {
  db = await createTestDb();
  deps = createTestServiceDeps(db);
  a = await seedRestaurant(db, "papi-a");
  b = await seedRestaurant(db, "papi-b");
});

afterAll(async () => {
  await db.end();
});

const orderBody = (f: RestaurantFixture, over: Record<string, unknown> = {}) => ({
  customer_id: f.customerId,
  fulfillment: "pickup" as const,
  payment_method: "pix" as const,
  items: [{ menu_item_id: f.menuItemId, size_id: f.menuItemSizeId, qty: 2 }],
  ...over,
});

describe("API key directory (FR-140, FR-141)", () => {
  test("lookup finds a key by hash through mt.api_key_lookup, revoked keys included with revoked_at", async () => {
    const dir = createDbApiKeyDirectory(deps);
    expect(await dir.lookup(a.apiKeyHash)).toMatchObject({ id: a.apiKeyId, restaurantId: a.restaurantId });
    expect(await dir.lookup(generateApiKey("live").hash)).toBeNull();
    const [revoked] = await db<{ hash: string }[]>`select hash from public.api_keys where id = ${a.revokedApiKeyId}`;
    expect((await dir.lookup(revoked?.hash ?? ""))?.revokedAt).not.toBeNull();
  });

  test("touch sets last_used_at through mt.touch_api_key", async () => {
    await db`update public.api_keys set last_used_at = null where id = ${a.apiKeyId}`;
    await createDbApiKeyDirectory(deps).touch(keyCtx(a));
    const [row] = await db<
      { last_used_at: Date | null }[]
    >`select last_used_at from public.api_keys where id = ${a.apiKeyId}`;
    expect(row?.last_used_at).not.toBeNull();
  });
});

describe("rate limiter and idempotency stores (FR-143, FR-145)", () => {
  test("counts per key and class in rate_counters", async () => {
    const limiter = createDbApiRateLimiter(deps);
    const now = new Date("2026-10-13T15:00:10Z");
    const first = await limiter.hit(a.apiKeyId, "write", now);
    const second = await limiter.hit(a.apiKeyId, "write", now);
    expect(first.remaining - second.remaining).toBe(1);
    expect((await limiter.hit(a.apiKeyId, "read", now)).remaining).toBe(599);
  });

  test("claim is atomic: the first claims, the second sees in_progress; complete makes it replayable", async () => {
    const store = createDbIdempotencyStore(deps);
    expect(await store.claim(keyCtx(a), "k-1", "h1")).toEqual({ kind: "claimed" });
    expect(await store.claim(keyCtx(a), "k-1", "h1")).toEqual({
      kind: "existing",
      row: { status: "in_progress", requestHash: "h1", responseStatus: null, responseBody: null },
    });
    await store.complete(keyCtx(a), "k-1", { status: 201, body: { id: "x" } });
    expect(await store.claim(keyCtx(a), "k-1", "h1")).toEqual({
      kind: "existing",
      row: { status: "completed", requestHash: "h1", responseStatus: 201, responseBody: { id: "x" } },
    });
    // another restaurant has its own key space
    expect(await store.claim(keyCtx(b), "k-1", "h1")).toEqual({ kind: "claimed" });
  });

  test("concurrent claims of one key: exactly one wins", async () => {
    const store = createDbIdempotencyStore(deps);
    const results = await Promise.all([1, 2, 3, 4].map(() => store.claim(keyCtx(a), "k-race", "h")));
    expect(results.filter((r) => r.kind === "claimed")).toHaveLength(1);
  });

  test("release deletes an in-progress claim; a stale claim is taken over", async () => {
    const store = createDbIdempotencyStore(deps);
    await store.claim(keyCtx(a), "k-2", "h1");
    await store.release(keyCtx(a), "k-2");
    expect(await store.claim(keyCtx(a), "k-2", "h2")).toEqual({ kind: "claimed" });
    await db`update public.idempotency_records set created_at = now() - interval '61 seconds'
             where restaurant_id = ${a.restaurantId} and idempotency_key = 'k-2'`;
    expect(await store.claim(keyCtx(a), "k-2", "h3")).toEqual({ kind: "claimed" });
  });
});

describe("orders over the API (FR-142)", () => {
  test("create sets source api and created_by_api_key; the server computes the total", async () => {
    const order = await apiCreateOrder(deps, keyCtx(a), orderBody(a));
    expect(order).toMatchObject({ source: "api", status: expect.any(String), customer_id: a.customerId });
    expect(order.total_cents).toBe(order.subtotal_cents + order.delivery_fee_cents);
    expect(order.items[0]).toMatchObject({ menu_item_id: a.menuItemId, qty: 2 });
    const [row] = await db<{ created_by_api_key: string | null }[]>`
      select created_by_api_key from public.orders where id = ${order.id}`;
    expect(row?.created_by_api_key).toBe(a.apiKeyId);
  });

  test("a customer of another restaurant is a field error on customer_id", async () => {
    const e = await apiCreateOrder(deps, keyCtx(a), orderBody(a, { customer_id: b.customerId })).catch((x) => x);
    expect(code(e)).toBe("validation_failed");
  });

  test("get by uuid and by code; another restaurant's order is 404", async () => {
    const order = await apiCreateOrder(deps, keyCtx(a), orderBody(a));
    expect((await apiGetOrder(deps, keyCtx(a), { id: order.id })).status_history.length).toBeGreaterThan(0);
    expect((await apiGetOrder(deps, keyCtx(a), { id: order.code })).id).toBe(order.id);
    expect(code(await apiGetOrder(deps, keyCtx(b), { id: order.id }).catch((x) => x))).toBe("not_found");
    expect(code(await apiGetOrder(deps, keyCtx(a), { id: "nope" }).catch((x) => x))).toBe("not_found");
  });

  test("list pages newest first with a keyset cursor and filters", async () => {
    await apiCreateOrder(deps, keyCtx(a), orderBody(a));
    await apiCreateOrder(deps, keyCtx(a), orderBody(a));
    const first = await apiListOrders(deps, keyCtx(a), { limit: 1, source: "api" });
    expect(first.data).toHaveLength(1);
    expect(first.next_cursor).not.toBeNull();
    const second = await apiListOrders(deps, keyCtx(a), { limit: 1, source: "api", cursor: first.next_cursor ?? "" });
    expect(second.data[0]?.id).not.toBe(first.data[0]?.id);
    expect((second.data[0]?.created_at ?? "") <= (first.data[0]?.created_at ?? "")).toBe(true);
    const others = await apiListOrders(deps, keyCtx(b), { limit: 100 });
    expect(others.data.every((o) => o.customer_id !== a.customerId)).toBe(true);
  });

  test("PATCH follows the status machine; a refused move is invalid_status_transition", async () => {
    const order = await apiCreateOrder(deps, keyCtx(a), orderBody(a));
    const moved = await apiChangeOrderStatus(deps, keyCtx(a), { id: order.id, status: "cancelado", reason: "teste" });
    expect(moved.status).toBe("cancelado");
    const e = await apiChangeOrderStatus(deps, keyCtx(a), { id: order.id, status: "confirmado" }).catch((x) => x);
    expect(code(e)).toBe("invalid_status_transition");
    expect(code(await apiChangeOrderStatus(deps, keyCtx(b), { id: order.id, status: "pronto" }).catch((x) => x))).toBe(
      "not_found",
    );
  });
});

describe("customers, menu, messages over the API", () => {
  test("create, duplicate phone 409, get, update, list; another restaurant's customer is 404", async () => {
    const c = await apiCreateCustomer(deps, keyCtx(a), { name: "Ana API", phone: "+5511944443333" });
    expect(c).toMatchObject({ name: "Ana API", orders_count: 0, total_spent_cents: 0 });
    expect(
      code(await apiCreateCustomer(deps, keyCtx(a), { name: "Dup", phone: "+5511944443333" }).catch((x) => x)),
    ).toBe("conflict");
    expect((await apiUpdateCustomer(deps, keyCtx(a), { id: c.id, cpf_cnpj: null, notes: "vip" })).notes).toBe("vip");
    expect((await apiGetCustomer(deps, keyCtx(a), { id: c.id })).id).toBe(c.id);
    expect(code(await apiGetCustomer(deps, keyCtx(b), { id: c.id }).catch((x) => x))).toBe("not_found");
    const page = await apiListCustomers(deps, keyCtx(a), { q: "Ana API" });
    expect(page.data.map((x) => x.id)).toContain(c.id);
  });

  test("menu lists unarchived items with sizes, without fiscal fields", async () => {
    const page = await apiListMenu(deps, keyCtx(a), {});
    const item = page.data.find((m) => m.id === a.menuItemId);
    expect(item?.sizes.length).toBeGreaterThan(0);
    expect(item).not.toHaveProperty("ncm");
    expect((await apiListMenu(deps, keyCtx(b), {})).data.find((m) => m.id === a.menuItemId)).toBeUndefined();
  });

  test("send outside the window is 422 and stores nothing; another restaurant's customer is 404", async () => {
    await db`update public.conversations set last_inbound_at = now() - interval '2 days' where id = ${a.conversationId}`;
    const before = await db`select count(*)::int as n from public.messages where restaurant_id = ${a.restaurantId}`;
    const e = await apiSendMessage(deps, keyCtx(a), { customer_id: a.customerId, body: "Oi" }).catch((x) => x);
    expect(code(e)).toBe("outside_service_window");
    const after = await db`select count(*)::int as n from public.messages where restaurant_id = ${a.restaurantId}`;
    expect(after[0]?.n).toBe(before[0]?.n);
    expect(code(await apiSendMessage(deps, keyCtx(b), { customer_id: a.customerId, body: "Oi" }).catch((x) => x))).toBe(
      "not_found",
    );
  });

  test("send inside the window stores a pending message and returns the 06 Message object", async () => {
    await db`update public.conversations set last_inbound_at = ${deps.clock.now()} where id = ${a.conversationId}`;
    const m = await apiSendMessage(deps, keyCtx(a), { customer_id: a.customerId, body: "Saiu para entrega" });
    expect(m).toMatchObject({ direction: "out", status: "pending", customer_id: a.customerId, order_id: null });
  });
});
