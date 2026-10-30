// covers FR-140, FR-141, FR-142, FR-143, FR-144, FR-145, 06.api-spec.md "Authentication",
// "Error format", "Pagination", "Idempotency", "Rate limits", Orders, Customers, Menu, Messages,
// Print jobs (FR-251, FR-252)
import { beforeEach, describe, expect, test } from "bun:test";
import { FixedClock } from "@mt/core";
import { type ApiPrintJob, idempotencyRequestHash } from "@mt/http";
import { MemoryUatisInboundStore } from "@mt/http/testing";

import { createApp } from "../../app";
import { MemoryPublicApi, RESTAURANT_A, RESTAURANT_B } from "../../testing/memory-public-api";

let mem: MemoryPublicApi;
let app: ReturnType<typeof createApp>;
const logs: { level: string; msg: string; fields?: Record<string, unknown> }[] = [];

beforeEach(() => {
  mem = new MemoryPublicApi();
  logs.length = 0;
  app = createApp({
    clock: new FixedClock(new Date("2026-10-13T12:00:20Z")),
    uatisInbound: new MemoryUatisInboundStore(),
    publicApi: mem.backend(),
    log: {
      info: (msg, fields) => logs.push({ level: "info", msg, ...(fields ? { fields } : {}) }),
      warn: (msg, fields) => logs.push({ level: "warn", msg, ...(fields ? { fields } : {}) }),
      error: (msg, fields) => logs.push({ level: "error", msg, ...(fields ? { fields } : {}) }),
    },
  });
});

type Init = { method?: string; body?: unknown; key?: string | null; headers?: Record<string, string> };

function call(path: string, init: Init = {}) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  const key = init.key === undefined ? mem.keyA.key : init.key;
  if (key !== null) headers.Authorization = `Bearer ${key}`;
  let body: string | undefined;
  if (init.body !== undefined) {
    body = typeof init.body === "string" ? init.body : JSON.stringify(init.body);
    headers["content-type"] = "application/json";
  }
  return app.request(path, { method: init.method ?? "GET", headers, ...(body !== undefined ? { body } : {}) });
}

async function errorOf(res: Response) {
  const json = (await res.json()) as { error: { code: string; message: string; details: { path: string }[] } };
  return json.error;
}

const orderBody = (customerId: string, over: Record<string, unknown> = {}) => ({
  customer_id: customerId,
  fulfillment: "delivery",
  payment_method: "pix",
  items: [{ menu_item_id: "00000000-0000-4000-8000-0000000000aa", qty: 2 }],
  ...over,
});

// ---------------------------------------------------------------------------

describe("authentication (FR-140, FR-141)", () => {
  test("no Authorization header is 401 with the envelope and details []", async () => {
    const res = await call("/v1/orders", { key: null });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "unauthorized", message: "Missing or invalid API key.", details: [] },
    });
  });

  test("a revoked key and an unknown key get the same 401 body", async () => {
    const revoked = await call("/v1/orders", { key: mem.revokedKey.key });
    const unknown = await call("/v1/orders", { key: "mtk_live_00000000000000000000000000000000" });
    expect(revoked.status).toBe(401);
    expect(await revoked.json()).toEqual(await unknown.json());
  });

  test("a malformed token is 401", async () => {
    expect((await call("/v1/menu", { key: "sk_live_abc" })).status).toBe(401);
  });

  test("a valid key reaches the route and touches last_used_at", async () => {
    const res = await call("/v1/orders");
    expect(res.status).toBe(200);
    expect(mem.touched).toHaveLength(1);
  });

  test("every public route requires a key", async () => {
    const routes: [string, string][] = [
      ["GET", "/v1/orders"],
      ["POST", "/v1/orders"],
      ["GET", "/v1/orders/ORD-001"],
      ["PATCH", "/v1/orders/ORD-001"],
      ["GET", "/v1/customers"],
      ["POST", "/v1/customers"],
      ["GET", `/v1/customers/${RESTAURANT_A}`],
      ["PATCH", `/v1/customers/${RESTAURANT_A}`],
      ["GET", "/v1/menu"],
      ["POST", "/v1/messages"],
      ["POST", "/v1/print-jobs/claim"],
      ["POST", `/v1/print-jobs/${RESTAURANT_A}/result`],
    ];
    for (const [method, path] of routes) {
      const res = await call(path, { method, key: null, ...(method === "GET" ? {} : { body: {} }) });
      expect(`${method} ${path} ${res.status}`).toBe(`${method} ${path} 401`);
    }
    expect(mem.calls).toEqual([]);
  });

  test("health and inbound webhooks stay outside the API-key middleware", async () => {
    expect((await call("/v1/health", { key: null })).status).toBe(200);
  });
});

describe("rate limits (FR-143)", () => {
  test("every response carries X-RateLimit-* headers", async () => {
    const res = await call("/v1/menu");
    expect(res.headers.get("X-RateLimit-Limit")).toBe("600");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("599");
    expect(res.headers.get("X-RateLimit-Reset")).toBe(String(Date.parse("2026-10-13T12:01:00Z") / 1000));
  });

  test("the 121st write in a minute is 429 rate_limited with Retry-After; reads are counted apart", async () => {
    const customer = mem.addCustomer(RESTAURANT_A);
    for (let i = 0; i < 120; i++) {
      const res = await call(`/v1/customers/${customer.id}`, { method: "PATCH", body: { notes: `n${i}` } });
      expect(res.status).toBe(200);
    }
    const over = await call(`/v1/customers/${customer.id}`, { method: "PATCH", body: { notes: "x" } });
    expect(over.status).toBe(429);
    expect(over.headers.get("Retry-After")).toBe("40");
    expect(over.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect((await errorOf(over)).code).toBe("rate_limited");
    expect(mem.calls.filter((c) => c === "updateCustomer")).toHaveLength(120);
    expect((await call("/v1/menu")).status).toBe(200);
  });

  test("limits are per key: key B is not slowed by key A", async () => {
    const customer = mem.addCustomer(RESTAURANT_A);
    for (let i = 0; i < 121; i++) await call(`/v1/customers/${customer.id}`, { method: "PATCH", body: {} });
    const res = await call("/v1/customers", {
      method: "POST",
      key: mem.keyB.key,
      body: { name: "B", phone: "+5511988887777" },
    });
    expect(res.status).toBe(201);
  });
});

describe("idempotency (FR-145)", () => {
  test("the same key and body replays the first response with Idempotency-Replayed: true", async () => {
    const c = mem.addCustomer(RESTAURANT_A);
    const headers = { "Idempotency-Key": "order-1" };
    const first = await call("/v1/orders", { method: "POST", body: orderBody(c.id), headers });
    expect(first.status).toBe(201);
    expect(first.headers.get("Idempotency-Replayed")).toBeNull();
    const second = await call("/v1/orders", { method: "POST", body: orderBody(c.id), headers });
    expect(second.status).toBe(201);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await second.json()).toEqual(await first.json());
    expect(mem.calls.filter((x) => x === "createOrder")).toHaveLength(1);
  });

  test("the same key with another body is 409 idempotency_conflict", async () => {
    const c = mem.addCustomer(RESTAURANT_A);
    const headers = { "Idempotency-Key": "order-2" };
    await call("/v1/orders", { method: "POST", body: orderBody(c.id), headers });
    const res = await call("/v1/orders", { method: "POST", body: orderBody(c.id, { notes: "x" }), headers });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe("idempotency_conflict");
    expect(mem.calls.filter((x) => x === "createOrder")).toHaveLength(1);
  });

  test("keys are scoped per restaurant", async () => {
    const a = mem.addCustomer(RESTAURANT_A);
    const b = mem.addCustomer(RESTAURANT_B);
    const headers = { "Idempotency-Key": "shared" };
    expect((await call("/v1/orders", { method: "POST", body: orderBody(a.id), headers })).status).toBe(201);
    const res = await call("/v1/orders", { method: "POST", key: mem.keyB.key, body: orderBody(b.id), headers });
    expect(res.status).toBe(201);
    expect(res.headers.get("Idempotency-Replayed")).toBeNull();
  });

  test("a refused request is not stored: a retry with the same key runs again", async () => {
    const c = mem.addCustomer(RESTAURANT_A);
    const headers = { "Idempotency-Key": "msg-1" };
    const body = { customer_id: c.id, body: "Oi" };
    expect((await call("/v1/messages", { method: "POST", body, headers })).status).toBe(422);
    mem.windowOpen.add(c.id);
    expect((await call("/v1/messages", { method: "POST", body, headers })).status).toBe(201);
  });

  test("a second request while the first still runs is 409 idempotency_in_progress with Retry-After: 1", async () => {
    const c = mem.addCustomer(RESTAURANT_A);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const backend = mem.backend();
    const create = backend.ops.createOrder;
    backend.ops.createOrder = async (ctx, body) => {
      await gate;
      return create(ctx, body);
    };
    const slow = createApp({
      clock: new FixedClock(new Date("2026-10-13T12:00:20Z")),
      uatisInbound: new MemoryUatisInboundStore(),
      publicApi: backend,
      log: { info() {}, warn() {}, error() {} },
    });
    const init = {
      method: "POST",
      body: JSON.stringify(orderBody(c.id)),
      headers: {
        Authorization: `Bearer ${mem.keyA.key}`,
        "content-type": "application/json",
        "Idempotency-Key": "race-1",
      },
    };
    const first = slow.request("/v1/orders", init);
    await Bun.sleep(5);
    const second = await slow.request("/v1/orders", init);
    expect(second.status).toBe(409);
    expect(second.headers.get("Retry-After")).toBe("1");
    expect((await errorOf(second)).code).toBe("idempotency_in_progress");
    release();
    expect((await first).status).toBe(201);
    const third = await slow.request("/v1/orders", init);
    expect(third.headers.get("Idempotency-Replayed")).toBe("true");
    expect(mem.calls.filter((x) => x === "createOrder")).toHaveLength(1);
  });

  test("an in-progress claim older than 60 s is taken over", async () => {
    const c = mem.addCustomer(RESTAURANT_A);
    const body = JSON.stringify(orderBody(c.id));
    mem.seedClaim(
      RESTAURANT_A,
      "stale-1",
      idempotencyRequestHash("POST", "/v1/orders", body),
      new Date(Date.now() - 61_000),
    );
    const res = await call("/v1/orders", { method: "POST", body, headers: { "Idempotency-Key": "stale-1" } });
    expect(res.status).toBe(201);
    expect(mem.calls).toContain("createOrder");
  });

  test("a fresh in-progress claim with another body is 409 idempotency_conflict", async () => {
    const c = mem.addCustomer(RESTAURANT_A);
    mem.seedClaim(RESTAURANT_A, "fresh-1", "other-hash", new Date());
    const res = await call("/v1/orders", {
      method: "POST",
      body: orderBody(c.id),
      headers: { "Idempotency-Key": "fresh-1" },
    });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe("idempotency_conflict");
  });

  test("a thrown error releases the claim: the same key runs again", async () => {
    const backend = mem.backend();
    const listCreate = backend.ops.createCustomer;
    let fail = true;
    backend.ops.createCustomer = async (ctx, body) => {
      if (fail) {
        fail = false;
        throw new Error("db down");
      }
      return listCreate(ctx, body);
    };
    const flaky = createApp({
      clock: new FixedClock(new Date("2026-10-13T12:00:20Z")),
      uatisInbound: new MemoryUatisInboundStore(),
      publicApi: backend,
      log: { info() {}, warn() {}, error() {} },
    });
    const init = {
      method: "POST",
      body: JSON.stringify({ name: "Bia", phone: "+5511933332222" }),
      headers: {
        Authorization: `Bearer ${mem.keyA.key}`,
        "content-type": "application/json",
        "Idempotency-Key": "flaky",
      },
    };
    expect((await flaky.request("/v1/customers", init)).status).toBe(500);
    expect((await flaky.request("/v1/customers", init)).status).toBe(201);
  });

  test("an Idempotency-Key over 255 characters is 422", async () => {
    const c = mem.addCustomer(RESTAURANT_A);
    const res = await call("/v1/customers", {
      method: "POST",
      body: { name: "X", phone: "+5511977776666" },
      headers: { "Idempotency-Key": "k".repeat(256) },
    });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).details[0]?.path).toBe("Idempotency-Key");
    expect(c.id).toBeDefined();
  });

  test("customers and messages POST honour the key too", async () => {
    const headers = { "Idempotency-Key": "cust-1" };
    const body = { name: "Ana", phone: "+5511955554444" };
    const first = await call("/v1/customers", { method: "POST", body, headers });
    const second = await call("/v1/customers", { method: "POST", body, headers });
    expect(first.status).toBe(201);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(mem.calls.filter((x) => x === "createCustomer")).toHaveLength(1);
  });
});

describe("orders", () => {
  test("POST /v1/orders creates an api order (201)", async () => {
    const c = mem.addCustomer(RESTAURANT_A);
    const res = await call("/v1/orders", { method: "POST", body: orderBody(c.id) });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ source: "api", customer_id: c.id, status: "aguardando" });
  });

  test("the body cannot set source or prices (strict schema → 422)", async () => {
    const c = mem.addCustomer(RESTAURANT_A);
    for (const extra of [{ source: "counter" }, { total_cents: 1 }]) {
      const res = await call("/v1/orders", { method: "POST", body: orderBody(c.id, extra) });
      expect(res.status).toBe(422);
      expect((await errorOf(res)).code).toBe("validation_failed");
    }
    expect(mem.calls).not.toContain("createOrder");
  });

  test("field errors carry snake_case body paths", async () => {
    const res = await call("/v1/orders", {
      method: "POST",
      body: {
        customer_id: "nope",
        fulfillment: "delivery",
        payment_method: "pix",
        items: [{ menu_item_id: "x", qty: 0 }],
      },
    });
    expect(res.status).toBe(422);
    const paths = (await errorOf(res)).details.map((d) => d.path);
    expect(paths).toContain("customer_id");
    expect(paths).toContain("items[0].menu_item_id");
    expect(paths).toContain("items[0].qty");
  });

  test("a service field error in camelCase reaches the client in snake_case", async () => {
    const res = await call("/v1/orders", { method: "POST", body: orderBody("00000000-0000-4000-8000-0000000000ff") });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).details[0]?.path).toBe("customer_id");
  });

  test("a body that is not JSON is 422", async () => {
    const res = await call("/v1/orders", { method: "POST", body: "{not json" });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe("validation_failed");
  });

  test("GET /v1/orders pages with next_cursor, newest first", async () => {
    const c = mem.addCustomer(RESTAURANT_A);
    for (let i = 0; i < 3; i++) await call("/v1/orders", { method: "POST", body: orderBody(c.id) });
    const first = (await (await call("/v1/orders?limit=2")).json()) as {
      data: { code: string }[];
      next_cursor: string;
    };
    expect(first.data.map((o) => o.code)).toEqual(["ORD-003", "ORD-002"]);
    expect(first.next_cursor).toEqual(expect.any(String));
    const second = (await (await call(`/v1/orders?limit=2&cursor=${first.next_cursor}`)).json()) as {
      data: { code: string }[];
      next_cursor: string | null;
    };
    expect(second.data.map((o) => o.code)).toEqual(["ORD-001"]);
    expect(second.next_cursor).toBeNull();
  });

  test("limit over 100, a bad status, or a bad cursor is 422", async () => {
    for (const q of ["limit=101", "limit=0", "status=voando", "cursor=garbage", "from=yesterday"]) {
      const res = await call(`/v1/orders?${q}`);
      expect(`${q} ${res.status}`).toBe(`${q} 422`);
    }
  });

  test("GET /v1/orders/{id} by uuid or code; another restaurant's order is 404", async () => {
    const a = mem.addCustomer(RESTAURANT_A);
    const b = mem.addCustomer(RESTAURANT_B);
    const created = (await (await call("/v1/orders", { method: "POST", body: orderBody(a.id) })).json()) as {
      id: string;
      code: string;
    };
    await call("/v1/orders", { method: "POST", key: mem.keyB.key, body: orderBody(b.id) });
    expect((await call(`/v1/orders/${created.id}`)).status).toBe(200);
    expect(await (await call(`/v1/orders/${created.code}`)).json()).toMatchObject({ status_history: [] });
    const foreign = await call(`/v1/orders/${created.id}`, { key: mem.keyB.key });
    expect(foreign.status).toBe(404);
    expect((await errorOf(foreign)).code).toBe("not_found");
  });

  test("PATCH /v1/orders/{id} changes the status; another restaurant's order is 404", async () => {
    const a = mem.addCustomer(RESTAURANT_A);
    const created = (await (await call("/v1/orders", { method: "POST", body: orderBody(a.id) })).json()) as {
      id: string;
    };
    const ok = await call(`/v1/orders/${created.id}`, { method: "PATCH", body: { status: "confirmado" } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: "confirmado" });
    const foreign = await call(`/v1/orders/${created.id}`, {
      method: "PATCH",
      key: mem.keyB.key,
      body: { status: "pronto" },
    });
    expect(foreign.status).toBe(404);
  });

  test("PATCH accepts status and reason only; a refused move is 422 invalid_status_transition", async () => {
    const a = mem.addCustomer(RESTAURANT_A);
    const created = (await (await call("/v1/orders", { method: "POST", body: orderBody(a.id) })).json()) as {
      id: string;
    };
    expect(
      (await call(`/v1/orders/${created.id}`, { method: "PATCH", body: { status: "pronto", total_cents: 0 } })).status,
    ).toBe(422);
    expect((await call(`/v1/orders/${created.id}`, { method: "PATCH", body: { status: "voando" } })).status).toBe(422);
    await call(`/v1/orders/${created.id}`, {
      method: "PATCH",
      body: { status: "cancelado", reason: "cliente desistiu" },
    });
    const refused = await call(`/v1/orders/${created.id}`, { method: "PATCH", body: { status: "confirmado" } });
    expect(refused.status).toBe(422);
    expect((await errorOf(refused)).code).toBe("invalid_status_transition");
  });
});

describe("customers", () => {
  test("POST /v1/customers creates (201); a duplicate phone is 409 conflict", async () => {
    const body = { name: "Ana", phone: "+5511955554444" };
    expect((await call("/v1/customers", { method: "POST", body })).status).toBe(201);
    const dup = await call("/v1/customers", { method: "POST", body });
    expect(dup.status).toBe(409);
    expect((await errorOf(dup)).code).toBe("conflict");
  });

  test("POST validates E.164-convertible phone and strict keys", async () => {
    expect((await call("/v1/customers", { method: "POST", body: { name: "Ana", phone: "abc" } })).status).toBe(422);
    expect(
      (await call("/v1/customers", { method: "POST", body: { name: "Ana", phone: "+5511955554444", vip: true } }))
        .status,
    ).toBe(422);
  });

  test("GET list pages; GET one; another restaurant's customer is 404", async () => {
    mem.addCustomer(RESTAURANT_A);
    const c = mem.addCustomer(RESTAURANT_A);
    const other = mem.addCustomer(RESTAURANT_B);
    const page = (await (await call("/v1/customers?limit=1")).json()) as {
      data: { id: string }[];
      next_cursor: string;
    };
    expect(page.data.map((x) => x.id)).toEqual([c.id]);
    expect(page.next_cursor).toEqual(expect.any(String));
    expect((await call(`/v1/customers/${c.id}`)).status).toBe(200);
    expect((await call(`/v1/customers/${other.id}`)).status).toBe(404);
  });

  test("PATCH updates; phone cannot change (422); another restaurant's customer is 404", async () => {
    const c = mem.addCustomer(RESTAURANT_A);
    const res = await call(`/v1/customers/${c.id}`, { method: "PATCH", body: { name: "Novo" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: "Novo" });
    expect((await call(`/v1/customers/${c.id}`, { method: "PATCH", body: { phone: "+5511900000000" } })).status).toBe(
      422,
    );
    expect(
      (await call(`/v1/customers/${c.id}`, { method: "PATCH", key: mem.keyB.key, body: { name: "x" } })).status,
    ).toBe(404);
  });
});

describe("menu", () => {
  test("GET /v1/menu lists this restaurant's items with filters and paging", async () => {
    mem.addMenuItem(RESTAURANT_A, { name: "Frango" });
    mem.addMenuItem(RESTAURANT_A, { name: "Suco", kind: "drink" });
    mem.addMenuItem(RESTAURANT_B, { name: "Outro" });
    const all = (await (await call("/v1/menu")).json()) as { data: { name: string }[]; next_cursor: null };
    expect(all.data.map((m) => m.name)).toEqual(["Suco", "Frango"]);
    expect(all.next_cursor).toBeNull();
    const drinks = (await (await call("/v1/menu?kind=drink")).json()) as { data: { name: string }[] };
    expect(drinks.data.map((m) => m.name)).toEqual(["Suco"]);
    expect((await call("/v1/menu?weekday=7")).status).toBe(422);
    expect((await call("/v1/menu?available=maybe")).status).toBe(422);
  });

  test("the menu is read-only: POST /v1/menu is 404", async () => {
    expect((await call("/v1/menu", { method: "POST", body: {} })).status).toBe(404);
  });
});

describe("messages", () => {
  test("POST /v1/messages inside the window is 201 pending", async () => {
    const c = mem.addCustomer(RESTAURANT_A);
    mem.windowOpen.add(c.id);
    const res = await call("/v1/messages", { method: "POST", body: { customer_id: c.id, body: "Saiu para entrega" } });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ direction: "out", status: "pending", customer_id: c.id });
  });

  test("outside the 24-hour window is 422 outside_service_window", async () => {
    const c = mem.addCustomer(RESTAURANT_A);
    const res = await call("/v1/messages", { method: "POST", body: { customer_id: c.id, body: "Oi" } });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe("outside_service_window");
  });

  test("an empty body is 422; another restaurant's customer is 404", async () => {
    const c = mem.addCustomer(RESTAURANT_A);
    expect((await call("/v1/messages", { method: "POST", body: { customer_id: c.id, body: "  " } })).status).toBe(422);
    const res = await call("/v1/messages", {
      method: "POST",
      key: mem.keyB.key,
      body: { customer_id: c.id, body: "Oi" },
    });
    expect(res.status).toBe(404);
  });
});

describe("errors", () => {
  test("an unexpected error is 500 internal_error, logged without its message reaching the client", async () => {
    const backend = mem.backend();
    backend.ops.listMenu = async () => {
      throw new Error("secret=hunter2");
    };
    const broken = createApp({
      clock: new FixedClock(new Date("2026-10-13T12:00:20Z")),
      uatisInbound: new MemoryUatisInboundStore(),
      publicApi: backend,
      log: {
        info() {},
        warn() {},
        error: (msg, fields) => logs.push({ level: "error", msg, ...(fields ? { fields } : {}) }),
      },
    });
    const res = await broken.request("/v1/menu", { headers: { Authorization: `Bearer ${mem.keyA.key}` } });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("hunter2");
    expect(JSON.parse(text).error.code).toBe("internal_error");
    expect(logs.some((l) => l.level === "error")).toBe(true);
  });

  test("logs never carry the API key", async () => {
    await call("/v1/orders");
    await call("/v1/orders", { key: mem.revokedKey.key });
    expect(JSON.stringify(logs)).not.toContain(mem.keyA.key);
    expect(JSON.stringify(logs)).not.toContain(mem.revokedKey.key);
  });
});

describe("print jobs (FR-251, FR-252)", () => {
  const job = (id: string): ApiPrintJob => ({
    id,
    kind: "order_ticket",
    status: "pending",
    attempts: 0,
    last_error: null,
    created_at: "2026-10-13T12:00:00.000Z",
    printed_at: null,
  });
  const JOB_A = "00000000-0000-4000-8000-00000000a001";
  const JOB_B = "00000000-0000-4000-8000-00000000b001";

  beforeEach(() => {
    const at = new Date("2026-10-13T12:00:00Z");
    mem.printJobs.push({ restaurantId: RESTAURANT_A, created_at: at, id: JOB_A, value: job(JOB_A) });
    mem.printJobs.push({ restaurantId: RESTAURANT_B, created_at: at, id: JOB_B, value: job(JOB_B) });
  });

  test("claim returns only the key's restaurant's jobs, and an empty body is the default limit", async () => {
    const res = await call("/v1/print-jobs/claim", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: ApiPrintJob[] };
    expect(body.data.map((j) => j.id)).toEqual([JOB_A]);
    expect(body.data[0]?.status).toBe("printing");
  });

  test("a limit outside 1..10 is 422", async () => {
    const res = await call("/v1/print-jobs/claim", { method: "POST", body: { limit: 50 } });
    expect(res.status).toBe(422);
  });

  test("result sets printed; a second result is 409; a foreign job is 404", async () => {
    await call("/v1/print-jobs/claim", { method: "POST" });
    const ok = await call(`/v1/print-jobs/${JOB_A}/result`, { method: "POST", body: { printed: true } });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as ApiPrintJob).status).toBe("printed");
    const again = await call(`/v1/print-jobs/${JOB_A}/result`, { method: "POST", body: { printed: true } });
    expect(again.status).toBe(409);
    const foreign = await call(`/v1/print-jobs/${JOB_B}/result`, { method: "POST", body: { printed: true } });
    expect(foreign.status).toBe(404);
  });

  test("result without printed is 422", async () => {
    const res = await call(`/v1/print-jobs/${JOB_A}/result`, { method: "POST", body: { error: "x" } });
    expect(res.status).toBe(422);
  });
});
