// covers FR-250, FR-251, FR-252
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { AppError, FixedClock } from "@mt/core";
import type { Db } from "@mt/db";
import { createTestDb, type RestaurantFixture, seedRestaurant } from "@mt/db/test-harness";

import type { ApiKeyContext } from "../../context";
import type { ServiceDeps } from "../../deps";
import { createTestServiceDeps, userCtx } from "../../testing";
import { cancelOrder, changeOrderStatus } from "../orders/change-status";
import { createOrder } from "../orders/create-order";
import { acceptsOrder } from "./enqueue";
import { apiClaimPrintJobs, apiReportPrintJobResult, PRINT_MAX_ATTEMPTS } from "./print-jobs";

let db: Db;
let clock: FixedClock;
let deps: ServiceDeps;
let a: RestaurantFixture;
let b: RestaurantFixture;

const code = (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`);
const att = () => userCtx(a.restaurantId, a.attendantId, "attendant");
const keyOf = (f: RestaurantFixture): ApiKeyContext => ({
  restaurantId: f.restaurantId,
  actorType: "api_key",
  apiKeyId: f.apiKeyId,
  role: "attendant",
});

const base = (over: Record<string, unknown> = {}) => ({
  customerId: a.customerId,
  items: [{ menuItemId: a.menuItemId, sizeId: a.menuItemSizeId, qty: 2, notes: "sem cebola" }],
  fulfillment: "pickup" as const,
  paymentMethod: "pix" as const,
  source: "counter" as const,
  ...over,
});

const jobsFor = (orderId: string) =>
  db<{ id: string; status: string; attempts: number }[]>`
    select id, status, attempts from public.print_jobs where restaurant_id = ${a.restaurantId} and order_id = ${orderId}`;

async function setPrinting(on: boolean, autoAccept = false) {
  await db`update public.restaurant_settings set auto_print_orders = ${on}, auto_accept = ${autoAccept}
    where restaurant_id = ${a.restaurantId}`;
}

beforeAll(async () => {
  db = await createTestDb();
  clock = new FixedClock("2026-10-13T15:00:00Z");
  deps = createTestServiceDeps(db, { clock });
  a = await seedRestaurant(db, "printing-a");
  b = await seedRestaurant(db, "printing-b");
});

afterAll(async () => {
  await db.end();
});

beforeEach(async () => {
  // Earlier tests leave jobs behind; the claim tests start from none waiting.
  await db`update public.print_jobs set status = 'printed' where restaurant_id in ${db([a.restaurantId, b.restaurantId])}`;
  await setPrinting(true);
});

describe("acceptsOrder", () => {
  test("a create or a move out of aguardando accepts, except to aguardando or cancelado", () => {
    expect(acceptsOrder(null, "confirmado")).toBe(true);
    expect(acceptsOrder(null, "aguardando")).toBe(false);
    expect(acceptsOrder("aguardando", "confirmado")).toBe(true);
    expect(acceptsOrder("aguardando", "pronto")).toBe(true);
    expect(acceptsOrder("aguardando", "cancelado")).toBe(false);
    expect(acceptsOrder("confirmado", "pronto")).toBe(false);
  });
});

describe("the order ticket job (FR-250)", () => {
  test("an order created as confirmado gets one pending job", async () => {
    await setPrinting(true, true);
    const created = await createOrder(deps, att(), base());
    expect(created.status).toBe("confirmado");
    expect(await jobsFor(created.id)).toMatchObject([{ status: "pending", attempts: 0 }]);
  });

  test("an aguardando order gets its job on confirm, and only one", async () => {
    const created = await createOrder(deps, att(), base());
    expect(await jobsFor(created.id)).toHaveLength(0);
    await changeOrderStatus(deps, att(), { orderId: created.id, toStatus: "confirmado" });
    await changeOrderStatus(deps, att(), { orderId: created.id, toStatus: "pronto" });
    expect(await jobsFor(created.id)).toHaveLength(1);
  });

  test("a cancelled aguardando order prints nothing", async () => {
    const created = await createOrder(deps, att(), base());
    await cancelOrder(deps, att(), { orderId: created.id, reason: "cliente desistiu" });
    expect(await jobsFor(created.id)).toHaveLength(0);
  });

  test("with the switch off, no order gets a job", async () => {
    await setPrinting(false, true);
    const created = await createOrder(deps, att(), base());
    expect(await jobsFor(created.id)).toHaveLength(0);
  });
});

describe("claim and result (FR-251, FR-252)", () => {
  async function confirmedOrder() {
    await setPrinting(true, true);
    return createOrder(deps, att(), base());
  }

  test("a claim leases the job with the ticket data; a second claim inside the lease gets nothing", async () => {
    const created = await confirmedOrder();
    const first = await apiClaimPrintJobs(deps, keyOf(a), {});
    expect(first.data).toHaveLength(1);
    const job = first.data[0];
    expect(job).toMatchObject({ status: "printing", attempts: 1, kind: "order_ticket" });
    expect(job?.ticket?.order.id).toBe(created.id);
    expect(job?.ticket?.order.items[0]).toMatchObject({ qty: 2, notes: "sem cebola" });
    expect(job?.ticket?.customer_name).not.toBe("");
    expect(job?.ticket?.timezone).toBe("America/Sao_Paulo");
    expect((await apiClaimPrintJobs(deps, keyOf(a), {})).data).toHaveLength(0);

    clock.advance(121_000);
    const again = await apiClaimPrintJobs(deps, keyOf(a), {});
    expect(again.data.map((j) => j.id)).toEqual([job?.id ?? ""]);
    expect(again.data[0]?.attempts).toBe(2);
  });

  test("another restaurant's key never sees the job", async () => {
    await confirmedOrder();
    expect((await apiClaimPrintJobs(deps, keyOf(b), {})).data).toHaveLength(0);
    const [job] = (await apiClaimPrintJobs(deps, keyOf(a), {})).data;
    const err = await apiReportPrintJobResult(deps, keyOf(b), { id: job?.id ?? "", printed: true }).catch((e) => e);
    expect(code(err)).toBe("not_found");
  });

  test("printed sets printed; a second result is 409", async () => {
    await confirmedOrder();
    const [job] = (await apiClaimPrintJobs(deps, keyOf(a), {})).data;
    const done = await apiReportPrintJobResult(deps, keyOf(a), { id: job?.id ?? "", printed: true });
    expect(done.status).toBe("printed");
    expect(done.printed_at).not.toBeNull();
    const err = await apiReportPrintJobResult(deps, keyOf(a), { id: job?.id ?? "", printed: true }).catch((e) => e);
    expect(code(err)).toBe("conflict");
  });

  test("a failed print goes back to pending, and fails for good on the last attempt", async () => {
    await confirmedOrder();
    let [job] = (await apiClaimPrintJobs(deps, keyOf(a), {})).data;
    const retry = await apiReportPrintJobResult(deps, keyOf(a), {
      id: job?.id ?? "",
      printed: false,
      error: "sem papel",
    });
    expect(retry).toMatchObject({ status: "pending", last_error: "sem papel" });

    for (let attempt = 2; attempt <= PRINT_MAX_ATTEMPTS; attempt++) {
      [job] = (await apiClaimPrintJobs(deps, keyOf(a), {})).data;
      expect(job?.attempts).toBe(attempt);
      const result = await apiReportPrintJobResult(deps, keyOf(a), { id: job?.id ?? "", printed: false });
      expect(result.status).toBe(attempt === PRINT_MAX_ATTEMPTS ? "failed" : "pending");
    }
    expect((await apiClaimPrintJobs(deps, keyOf(a), {})).data).toHaveLength(0);
  });

  test("an id that is not a uuid is 404", async () => {
    const err = await apiReportPrintJobResult(deps, keyOf(a), { id: "nope", printed: true }).catch((e) => e);
    expect(code(err)).toBe("not_found");
  });
});
