// covers FR-124, FR-125, FR-127, FR-130, FR-136, FR-137, ADR-007, ADR-016
// Needs the local stack (`bun run dev:stack`) or TEST_DATABASE_URL.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeInvoiceGateway, FixedClock, GatewayError } from "@mt/core";
import { type Db, QUEUES } from "@mt/db";
import { createTestDb, type RestaurantFixture, seedRestaurant, truncateQueues } from "@mt/db/test-harness";
import {
  cancelInvoice,
  type GatewayFactory,
  issueInvoice,
  saveFiscalConfig,
  type ServiceDeps,
  testFiscalConnection,
} from "@mt/http";
import { createTestServiceDeps, userCtx } from "@mt/http/testing";
import type { InvoiceJob } from "@mt/schemas";

import type { JobContext } from "./framework/types";
import {
  createInvoiceCancelHandler,
  createInvoiceIssueHandler,
  createInvoicePollHandler,
} from "./handlers/invoice-jobs";
import { DbInvoiceJobStore } from "./stores/invoice-store";

const NOW = new Date("2026-10-13T15:00:00Z");

let db: Db;
let gateway: FakeInvoiceGateway;
let deps: ServiceDeps;
let a: RestaurantFixture;

beforeAll(async () => {
  db = await createTestDb();
  gateway = new FakeInvoiceGateway();
  const gateways: GatewayFactory = {
    whatsapp: () => {
      throw new Error("not used");
    },
    invoices: () => gateway,
  };
  deps = createTestServiceDeps(db, { clock: new FixedClock(NOW), gateways });
  a = await seedRestaurant(db, "wk-nf");
  const admin = userCtx(a.restaurantId, a.adminId, "admin");
  await saveFiscalConfig(deps, admin, {
    baseUrl: "http://127.0.0.1:4020",
    apiKey: "nfk_test_worker",
    webhookSecret: "whsec_nf_worker",
    environment: "homologacao",
    nfceSerie: 1,
    nfeSerie: 1,
    defaults: { ncm: "21069090", cfop: "5101", csosn: "102", pisCst: "49", cofinsCst: "49" },
    deliveryFeeMode: "item",
  });
  await testFiscalConnection(deps, admin, undefined);
  // The fixture's own invoice row holds the fixture order; free it.
  await db`update public.order_invoices set status = 'failed' where id = ${a.orderInvoiceId}`;
  // One step at a time: the transition trigger refuses jumps.
  for (const status of ["confirmado", "preparando", "pronto"]) {
    await db`update public.orders set status = ${status} where id = ${a.orderId}`;
  }
});

beforeEach(async () => {
  await truncateQueues(db);
});

afterAll(async () => {
  await db.end();
});

const store = () => new DbInvoiceJobStore(deps);
const handlerDeps = () => ({ store: store(), gatewayFor: () => gateway });
const ctx = (orderInvoiceId: string, op: InvoiceJob["op"]): JobContext<InvoiceJob> => ({
  queue: QUEUES.invoiceJobs,
  msgId: 1,
  payload: { v: 1, restaurantId: a.restaurantId, orderInvoiceId, op },
  attempt: 1,
  readCount: 1,
  signal: new AbortController().signal,
});

async function row(id: string) {
  const [r] = await db<
    { status: string; external_id: string | null; error_code: string | null; cancel_requested_at: Date | null }[]
  >`select status, external_id, error_code, cancel_requested_at from public.order_invoices where id = ${id}`;
  return r;
}

async function newInvoice(): Promise<string> {
  await db`update public.order_invoices set status = 'failed' where order_id = ${a.orderId} and status <> 'failed'`;
  const r = await issueInvoice(deps, userCtx(a.restaurantId, a.attendantId, "attendant"), {
    orderId: a.orderId,
    fill: { cpfCnpj: "52998224725", cep: "05415000", numero: "342" },
  });
  if (r.outcome !== "queued") throw new Error(`expected queued, got ${JSON.stringify(r)}`);
  return r.invoice.id;
}

describe("mt_invoice_jobs against Postgres", () => {
  test("issue sends the frozen payload, stores external_id, and queues a poll", async () => {
    const id = await newInvoice();
    expect(await createInvoiceIssueHandler(handlerDeps()).run(ctx(id, "issue"))).toEqual({ kind: "ok" });
    const call = gateway.calls.at(-1);
    expect(call?.method === "createInvoice" && call.idempotencyKey).toBe(id);
    expect((await row(id))?.external_id).not.toBeNull();
    const [poll] = await db<{ n: number }[]>`
      select count(*)::int as n from pgmq.q_mt_invoice_jobs where message ->> 'op' = 'poll' and message ->> 'orderInvoiceId' = ${id}`;
    expect(poll?.n).toBe(1);
  });

  test("a rerun of the same issue job skips (already sent)", async () => {
    const id = await newInvoice();
    await createInvoiceIssueHandler(handlerDeps()).run(ctx(id, "issue"));
    const before = gateway.calls.length;
    await createInvoiceIssueHandler(handlerDeps()).run(ctx(id, "issue"));
    expect(gateway.calls.length).toBe(before);
  });

  test("a refusal marks the row failed with the 08 text", async () => {
    const id = await newInvoice();
    gateway.failNextCreate(GatewayError.http(422, "certificate_missing"));
    await createInvoiceIssueHandler(handlerDeps()).run(ctx(id, "issue"));
    expect(await row(id)).toMatchObject({ status: "failed", error_code: "certificate_missing" });
  });

  test("poll applies authorized; cancel then poll applies cancelled", async () => {
    const id = await newInvoice();
    await createInvoiceIssueHandler(handlerDeps()).run(ctx(id, "issue"));
    const ext = (await row(id))?.external_id as string;
    gateway.authorize(ext);
    await createInvoicePollHandler(handlerDeps()).run(ctx(id, "poll"));
    expect((await row(id))?.status).toBe("authorized");

    await cancelInvoice(deps, userCtx(a.restaurantId, a.adminId, "admin"), {
      orderInvoiceId: id,
      justificativa: "Pedido lançado em duplicidade",
    });
    expect(await createInvoiceCancelHandler(handlerDeps()).run(ctx(id, "cancel"))).toEqual({ kind: "ok" });
    await createInvoicePollHandler(handlerDeps()).run(ctx(id, "poll"));
    expect((await row(id))?.status).toBe("cancelled");
  });

  test("a cancel refused by web-nf frees the request for another try", async () => {
    const id = await newInvoice();
    await createInvoiceIssueHandler(handlerDeps()).run(ctx(id, "issue"));
    const ext = (await row(id))?.external_id as string;
    gateway.authorize(ext);
    await createInvoicePollHandler(handlerDeps()).run(ctx(id, "poll"));
    await cancelInvoice(deps, userCtx(a.restaurantId, a.adminId, "admin"), {
      orderInvoiceId: id,
      justificativa: "Pedido lançado em duplicidade",
    });
    gateway.update(ext, { status: "processing" });
    await createInvoiceCancelHandler(handlerDeps()).run(ctx(id, "cancel"));
    expect(await row(id)).toMatchObject({
      status: "authorized",
      error_code: "cancel_conflict",
      cancel_requested_at: null,
    });
  });
});
