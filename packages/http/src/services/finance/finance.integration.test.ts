// covers FR-160, FR-161, FR-162, FR-163, FR-164, FR-165, FR-166, FR-167, FR-168, FR-169, ADR-020
// Needs the local stack (`bun run dev:stack`) or TEST_DATABASE_URL.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { AppError, FakeInvoiceGateway, FixedClock } from "@mt/core";
import type { Db } from "@mt/db";
import {
  asService,
  createTestDb,
  errorCode,
  INSUFFICIENT_PRIVILEGE,
  type RestaurantFixture,
  seedRestaurant,
  truncateQueues,
} from "@mt/db/test-harness";

import type { ServiceDeps } from "../../deps";
import { createTestServiceDeps, userCtx } from "../../testing";
import { saveFiscalConfig, testFiscalConnection } from "../admin";
import { changeOrderStatus, getOrder } from "../orders";
import { issueInvoicesBatch } from "./batch";
import { FINANCE_PAGE_SIZE, getFinanceTotals, listPaidOrders } from "./list";
import { markOrderPaid, unmarkOrderPaid } from "./payment";

// 2026-10-13 12:00 in America/Sao_Paulo.
const NOW = new Date("2026-10-13T15:00:00Z");
const CPF = "52998224725";

let db: Db;
let deps: ServiceDeps;
let gateway: FakeInvoiceGateway;
let a: RestaurantFixture;
let b: RestaurantFixture;
let p: RestaurantFixture;

const admin = (f = a) => userCtx(f.restaurantId, f.adminId, "admin");
const attendant = (f = a) => userCtx(f.restaurantId, f.attendantId, "attendant");
const code = (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`);

let counter = 0;

/** A customer of `f`. */
async function makeCustomer(f: RestaurantFixture, name = "Joana", cpf: string | null = null): Promise<string> {
  counter += 1;
  const [c] = await db<{ id: string }[]>`
    insert into public.customers (restaurant_id, name, phone, cpf_cnpj)
    values (${f.restaurantId}, ${name}, ${`+55119${String(counter).padStart(8, "0")}`}, ${cpf})
    returning id`;
  return c?.id as string;
}

/**
 * An order of one Frango Grelhado (R$ 18,90 × 2), inserted on the owner connection. `paidAt`
 * is written directly (no service context, so the paid guard does not apply).
 */
async function makeOrder(
  f: RestaurantFixture,
  opts: {
    status?: string;
    fulfillment?: "pickup" | "delivery";
    paidAt?: string | null;
    method?: "pix" | "dinheiro" | "cartao_credito" | "cartao_debito";
    customerId?: string;
  } = {},
): Promise<{ orderId: string; customerId: string; code: string }> {
  const status = opts.status ?? "pronto";
  const fulfillment = opts.fulfillment ?? "pickup";
  const customerId = opts.customerId ?? (await makeCustomer(f));
  counter += 1;
  const orderCode = `ORD-${String(900000 + counter)}`;
  const fee = fulfillment === "delivery" ? 500 : 0;
  return db.begin(async (sql) => {
    const [o] = await sql<{ id: string }[]>`
      insert into public.orders
        (restaurant_id, code, customer_id, status, fulfillment, logradouro, bairro, payment_method,
         subtotal_cents, delivery_fee_cents, total_cents, source, paid_at)
      values (${f.restaurantId}, ${orderCode}, ${customerId}, ${status}, ${fulfillment},
              ${fulfillment === "delivery" ? "Rua A" : null}, ${fulfillment === "delivery" ? "Centro" : null},
              ${opts.method ?? "pix"}, 3780, ${fee}, ${3780 + fee}, 'counter', ${opts.paidAt ?? null})
      returning id`;
    await sql`
      insert into public.order_items (restaurant_id, order_id, menu_item_id, name, size_name, unit_price_cents, qty)
      values (${f.restaurantId}, ${o?.id}, ${f.menuItemId}, 'Frango Grelhado', 'M', 1890, 2)`;
    return { orderId: o?.id as string, customerId, code: orderCode };
  });
}

async function auditRows(orderId: string): Promise<{ action: string }[]> {
  const rows = await db<{ action: string; type: string; code: string | null }[]>`
    select action, jsonb_typeof(context) as type, context ->> 'code' as code
    from public.audit_logs where entity_id = ${orderId} and action like 'order.%paid' order by created_at`;
  // The context is a JSON object with the order code (FR-163).
  for (const r of rows) {
    expect(r.type).toBe("object");
    expect(r.code).toMatch(/^ORD-/);
  }
  return rows.map((r) => ({ action: r.action }));
}

beforeAll(async () => {
  db = await createTestDb();
  gateway = new FakeInvoiceGateway();
  deps = createTestServiceDeps(db, {
    clock: new FixedClock(NOW),
    gateways: {
      whatsapp: () => {
        throw new Error("not used");
      },
      invoices: () => gateway,
    },
  });
  a = await seedRestaurant(db, "fin-a");
  b = await seedRestaurant(db, "fin-b");
  p = await seedRestaurant(db, "fin-pages");
  await saveFiscalConfig(deps, admin(), {
    baseUrl: "http://127.0.0.1:4020",
    apiKey: "nfk_test_integration",
    webhookSecret: "whsec_nf_finance",
    environment: "homologacao",
    nfceSerie: 1,
    nfeSerie: 1,
    defaults: { ncm: "21069090", cfop: "5101", csosn: "102", pisCst: "49", cofinsCst: "49" },
    deliveryFeeMode: "item",
  });
  await testFiscalConnection(deps, admin(), undefined);
});

beforeEach(async () => {
  await truncateQueues(db);
});

afterAll(async () => {
  await db.end();
});

describe("paid_at on entregue (FR-160)", () => {
  test("delivery marks an unpaid order paid, by the user who moved it", async () => {
    const { orderId } = await makeOrder(a, { status: "pronto" });
    await changeOrderStatus(deps, attendant(), { orderId, toStatus: "entregue" });
    const [row] = await db<{ paid_at: Date | null; paid_by: string | null; delivered_at: Date }[]>`
      select paid_at, paid_by, delivered_at from public.orders where id = ${orderId}`;
    expect(row?.paid_at).not.toBeNull();
    expect(row?.paid_at?.getTime()).toBe(row?.delivered_at.getTime());
    expect(row?.paid_by).toBe(a.attendantId);
    expect((await getOrder(deps, attendant(), { orderId })).paidAt).toBe(row?.paid_at?.toISOString() ?? "x");
  });

  test("a payment marked before delivery keeps its time", async () => {
    const { orderId } = await makeOrder(a, { status: "pronto" });
    await markOrderPaid(deps, attendant(), { orderId });
    await changeOrderStatus(deps, attendant(), { orderId, toStatus: "entregue" });
    const [row] = await db<{ paid_at: Date }[]>`select paid_at from public.orders where id = ${orderId}`;
    expect(row?.paid_at.toISOString()).toBe(NOW.toISOString());
  });
});

describe("markOrderPaid / unmarkOrderPaid (FR-161..FR-163)", () => {
  test("an attendant marks an order; a second mark changes nothing and writes no audit row", async () => {
    const { orderId } = await makeOrder(a, { status: "preparando" });
    const first = await markOrderPaid(deps, attendant(), { orderId });
    expect(first).toEqual({ paidAt: NOW.toISOString(), changed: true });
    const [row] = await db<{ paid_by: string }[]>`select paid_by from public.orders where id = ${orderId}`;
    expect(row?.paid_by).toBe(a.attendantId);
    const again = await markOrderPaid(deps, attendant(), { orderId });
    expect(again.changed).toBe(false);
    expect(await auditRows(orderId)).toEqual([{ action: "order.mark_paid" }]);
  });

  test("a cancelled order cannot be marked paid", async () => {
    const { orderId } = await makeOrder(a, { status: "cancelado" });
    expect(code(await markOrderPaid(deps, attendant(), { orderId }).catch((e) => e))).toBe("conflict");
  });

  test("another restaurant's order is not found", async () => {
    const { orderId } = await makeOrder(b, { status: "pronto" });
    expect(code(await markOrderPaid(deps, attendant(), { orderId }).catch((e) => e))).toBe("not_found");
  });

  test("only the admin clears the mark; the clear is audited", async () => {
    const { orderId } = await makeOrder(a, { status: "pronto" });
    await markOrderPaid(deps, attendant(), { orderId });
    expect(code(await unmarkOrderPaid(deps, attendant(), { orderId }).catch((e) => e))).toBe("forbidden");
    const r = await unmarkOrderPaid(deps, admin(), { orderId });
    expect(r).toEqual({ paidAt: null, changed: true });
    const [row] = await db<{ paid_at: Date | null; paid_by: string | null }[]>`
      select paid_at, paid_by from public.orders where id = ${orderId}`;
    expect(row).toEqual({ paid_at: null, paid_by: null });
    expect(await auditRows(orderId)).toEqual([{ action: "order.mark_paid" }, { action: "order.unmark_paid" }]);
    expect((await unmarkOrderPaid(deps, admin(), { orderId })).changed).toBe(false);
  });

  test("the database refuses a clear by an attendant on any path (orders_paid_guard)", async () => {
    const { orderId } = await makeOrder(a, { status: "pronto", paidAt: "2026-10-13T14:00:00Z" });
    const attendantClear = await errorCode(() =>
      asService(db, a.attendantCtx, (tx) => tx`update public.orders set paid_at = null where id = ${orderId}`),
    );
    expect(attendantClear).toBe(INSUFFICIENT_PRIVILEGE);
    const apiKeyClear = await errorCode(() =>
      asService(db, a.apiKeyCtx, (tx) => tx`update public.orders set paid_at = null where id = ${orderId}`),
    );
    expect(apiKeyClear).toBe(INSUFFICIENT_PRIVILEGE);
    // An attendant may still set it (marking is attendant work).
    expect(
      await errorCode(() =>
        asService(db, a.attendantCtx, (tx) => tx`update public.orders set paid_at = now() where id = ${orderId}`),
      ),
    ).toBeNull();
    expect(
      await errorCode(() =>
        asService(db, a.adminCtx, (tx) => tx`update public.orders set paid_at = null where id = ${orderId}`),
      ),
    ).toBeNull();
  });
});

describe("listPaidOrders / getFinanceTotals (FR-164..FR-166, FR-169)", () => {
  let customer: string;
  type Key =
    | "oct1"
    | "oct31late"
    | "nov1"
    | "advance"
    | "unpaid"
    | "cancelledPaid"
    | "issued"
    | "failed"
    | "cancelledInvoice";
  const ids = {} as Record<Key, string>;

  beforeAll(async () => {
    // Restaurant P holds only these orders, so the expectations are exact.
    customer = await makeCustomer(p, "Cliente Fiel", CPF);
    ids.oct1 = (
      await makeOrder(p, { status: "entregue", paidAt: "2026-10-01T03:00:00Z", method: "pix", customerId: customer })
    ).orderId;
    // 23:30 on 31 October in São Paulo is 02:30 UTC on 1 November.
    ids.oct31late = (
      await makeOrder(p, { status: "entregue", paidAt: "2026-11-01T02:30:00Z", method: "dinheiro" })
    ).orderId;
    ids.nov1 = (await makeOrder(p, { status: "entregue", paidAt: "2026-11-01T03:30:00Z", method: "pix" })).orderId;
    ids.advance = (
      await makeOrder(p, { status: "preparando", paidAt: "2026-10-10T15:00:00Z", method: "cartao_credito" })
    ).orderId;
    ids.unpaid = (await makeOrder(p, { status: "pronto" })).orderId;
    ids.cancelledPaid = (await makeOrder(p, { status: "cancelado", paidAt: "2026-10-05T15:00:00Z" })).orderId;
    ids.issued = (
      await makeOrder(p, { status: "entregue", paidAt: "2026-10-20T15:00:00Z", method: "cartao_debito" })
    ).orderId;
    ids.failed = (await makeOrder(p, { status: "entregue", paidAt: "2026-10-21T15:00:00Z", method: "pix" })).orderId;
    ids.cancelledInvoice = (
      await makeOrder(p, { status: "entregue", paidAt: "2026-10-22T15:00:00Z", method: "pix" })
    ).orderId;
    await db`
      insert into public.order_invoices (restaurant_id, order_id, kind, status, numero)
      values (${p.restaurantId}, ${ids.issued}, 'nfce', 'authorized', 42),
             (${p.restaurantId}, ${ids.failed}, 'nfce', 'rejected', null),
             (${p.restaurantId}, ${ids.cancelledInvoice}, 'nfce', 'cancelled', 7)`;
  });

  const october = { from: "2026-10-01", to: "2026-10-31" };
  const codes = (rows: readonly { id: string }[]) => rows.map((r) => r.id);

  test("the list holds paid orders only, newest payment first, with the invoice state", async () => {
    const page = await listPaidOrders(deps, admin(p), october);
    expect(codes(page.rows)).toEqual([
      ids.oct31late,
      ids.cancelledInvoice,
      ids.failed,
      ids.issued,
      ids.advance,
      ids.oct1,
    ]);
    expect(page.rows.find((r) => r.id === ids.issued)?.invoice).toMatchObject({ status: "authorized", numero: 42 });
    expect(page.rows.find((r) => r.id === ids.advance)?.invoice).toBeNull();
    expect(page.nextCursor).toBeNull();
    expect(page.timezone).toBe("America/Sao_Paulo");
  });

  test("the default range is the current local month", async () => {
    const page = await listPaidOrders(deps, admin(p), {});
    expect(page).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(page.rows).toHaveLength(6);
  });

  test("the range uses local days: 23:30 on 31 October is October, not November (FR-165)", async () => {
    const nov = await listPaidOrders(deps, admin(p), { from: "2026-11-01", to: "2026-11-30" });
    expect(codes(nov.rows)).toEqual([ids.nov1]);
  });

  test("filters: customer and invoice state", async () => {
    expect(codes((await listPaidOrders(deps, admin(p), { ...october, customerId: customer })).rows)).toEqual([
      ids.oct1,
    ]);
    expect(codes((await listPaidOrders(deps, admin(p), { ...october, invoiceState: "issued" })).rows)).toEqual([
      ids.issued,
    ]);
    expect(codes((await listPaidOrders(deps, admin(p), { ...october, invoiceState: "failed" })).rows)).toEqual([
      ids.failed,
    ]);
    expect(codes((await listPaidOrders(deps, admin(p), { ...october, invoiceState: "none" })).rows)).toEqual([
      ids.oct31late,
      ids.cancelledInvoice,
      ids.advance,
      ids.oct1,
    ]);
  });

  test("totals cover the filtered set; method totals add up to the gross total (FR-166)", async () => {
    const t = await getFinanceTotals(deps, admin(p), october);
    expect(t.count).toBe(6);
    expect(t.totalCents).toBe(6 * 3780);
    expect(t.byMethod).toEqual({
      pix: { count: 3, totalCents: 3 * 3780 },
      dinheiro: { count: 1, totalCents: 3780 },
      cartao_credito: { count: 1, totalCents: 3780 },
      cartao_debito: { count: 1, totalCents: 3780 },
    });
    const none = await getFinanceTotals(deps, admin(p), { ...october, invoiceState: "issued" });
    expect(none.byMethod.pix).toEqual({ count: 0, totalCents: 0 });
  });

  test("a range over 366 days or backwards is refused", async () => {
    expect(code(await listPaidOrders(deps, admin(p), { from: "2025-01-01", to: "2026-10-31" }).catch((e) => e))).toBe(
      "validation_failed",
    );
    expect(code(await getFinanceTotals(deps, admin(p), { from: "2026-10-31", to: "2026-10-01" }).catch((e) => e))).toBe(
      "validation_failed",
    );
  });

  test("the attendant cannot read the Finance data (FR-169)", async () => {
    expect(code(await listPaidOrders(deps, attendant(p), october).catch((e) => e))).toBe("forbidden");
    expect(code(await getFinanceTotals(deps, attendant(p), october).catch((e) => e))).toBe("forbidden");
    expect(code(await issueInvoicesBatch(deps, attendant(p), { orderIds: [ids.oct1] }).catch((e) => e))).toBe(
      "forbidden",
    );
  });

  test("restaurant B sees none of P's orders", async () => {
    const page = await listPaidOrders(deps, admin(b), october);
    expect(page.rows.some((r) => Object.values(ids).includes(r.id))).toBe(false);
  });
});

describe("pagination (FR-164)", () => {
  test("pages of 50 continue with no gap and no repeat, even with equal payment times", async () => {
    const f = await seedRestaurant(db, "fin-paging");
    const made: string[] = [];
    for (let i = 0; i < FINANCE_PAGE_SIZE + 7; i += 1) {
      // Pairs share a payment time; microseconds must survive the cursor.
      const paidAt = `2026-10-12T12:00:00.${String(100000 + Math.floor(i / 2)).slice(1)}Z`;
      made.push((await makeOrder(f, { status: "entregue", paidAt })).orderId);
    }
    const range = { from: "2026-10-01", to: "2026-10-31" };
    const first = await listPaidOrders(deps, admin(f), range);
    expect(first.rows).toHaveLength(FINANCE_PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();
    const second = await listPaidOrders(deps, admin(f), { ...range, cursor: first.nextCursor ?? "" });
    expect(second.nextCursor).toBeNull();
    const all = [...first.rows, ...second.rows].map((r) => r.id);
    expect(new Set(all).size).toBe(all.length);
    // The fixture's own seeded order has no paid_at, so the set is exactly what we made.
    expect([...all].sort()).toEqual([...made].sort());
    expect(code(await listPaidOrders(deps, admin(f), { ...range, cursor: "garbage" }).catch((e) => e))).toBe(
      "validation_failed",
    );
  });
});

describe("issueInvoicesBatch (FR-167, FR-168)", () => {
  test("each order gets its own result: issued, blocked with missing fields, skipped, not found", async () => {
    const ready = await makeOrder(a, { status: "entregue", fulfillment: "pickup", paidAt: "2026-10-13T14:00:00Z" });
    const noCpf = await makeOrder(a, { status: "entregue", fulfillment: "delivery", paidAt: "2026-10-13T14:00:00Z" });
    const already = await makeOrder(a, { status: "entregue", fulfillment: "pickup", paidAt: "2026-10-13T14:00:00Z" });
    const foreign = await makeOrder(b, { status: "entregue", fulfillment: "pickup", paidAt: "2026-10-13T14:00:00Z" });
    const firstIssue = await issueInvoicesBatch(deps, admin(), { orderIds: [already.orderId] });
    expect(firstIssue.results[0]?.outcome).toBe("issued");
    await truncateQueues(db);

    const { results } = await issueInvoicesBatch(deps, admin(), {
      orderIds: [ready.orderId, noCpf.orderId, already.orderId, foreign.orderId, ready.orderId],
    });
    expect(results.map((r) => [r.orderId, r.outcome])).toEqual([
      [ready.orderId, "issued"],
      [noCpf.orderId, "blocked"],
      [already.orderId, "skipped"],
      [foreign.orderId, "blocked"],
    ]);
    expect(results[0]?.code).toBe(ready.code);
    const blocked = results[1];
    if (blocked?.outcome !== "blocked") throw new Error("expected blocked");
    expect(blocked.missingFields).toContain("customer.cpf_cnpj");
    const missing = results[3];
    if (missing?.outcome !== "blocked") throw new Error("expected blocked");
    expect(missing.problems[0]?.code).toBe("not_found");

    // Only the ready order created a row and a job; the foreign order is untouched.
    const rows = await db<{ order_id: string }[]>`
      select order_id from public.order_invoices where order_id in ${db([ready.orderId, noCpf.orderId, foreign.orderId])}`;
    expect(rows.map((r) => r.order_id)).toEqual([ready.orderId]);
    const jobs = await db<{ n: number }[]>`select count(*)::int as n from pgmq.q_mt_invoice_jobs`;
    expect(jobs[0]?.n).toBe(1);
  });

  test("more than 50 orders is refused", async () => {
    const many = Array.from({ length: 51 }, () => crypto.randomUUID());
    expect(code(await issueInvoicesBatch(deps, admin(), { orderIds: many }).catch((e) => e))).toBe("validation_failed");
  });
});
