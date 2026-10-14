// covers FR-120, FR-121, FR-122, FR-123, FR-125, FR-126, FR-127, FR-128, FR-129, FR-130, FR-132,
// FR-135, FR-136, NFR-001, ADR-015, ADR-016
// Needs the local stack (`bun run dev:stack`) or TEST_DATABASE_URL.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeInvoiceGateway, FixedClock, parseNfWebhookEvent, signWebhook } from "@mt/core";
import type { Db } from "@mt/db";
import { asService, createTestDb, type RestaurantFixture, seedRestaurant, truncateQueues } from "@mt/db/test-harness";

import type { ServiceDeps } from "../../deps";
import { createTestServiceDeps, userCtx } from "../../testing";
import { saveFiscalConfig, testFiscalConnection } from "../admin";
import { getOrder } from "../orders";
import { applyWebNfEvent, createDbWebNfInboundStore, receiveWebNfWebhook } from "./inbound-webhook";
import { issueInvoice } from "./issue";
import { cancelInvoice, getInvoiceFiles, refreshInvoice } from "./remote";
import { applyInvoiceUpdate } from "./shared";

const NOW = new Date("2026-10-13T15:00:00Z");
const WEBHOOK_SECRET = "whsec_nf_integration";
const CPF = "52998224725";
const CNPJ = "11222333000181";

let db: Db;
let deps: ServiceDeps;
let gateway: FakeInvoiceGateway;
let a: RestaurantFixture;
let b: RestaurantFixture;

const admin = () => userCtx(a.restaurantId, a.adminId, "admin");
const attendant = () => userCtx(a.restaurantId, a.attendantId, "attendant");

async function invoiceJobs(): Promise<{ op: string; orderInvoiceId: string }[]> {
  return db<{ op: string; orderInvoiceId: string }[]>`
    select message ->> 'op' as op, message ->> 'orderInvoiceId' as "orderInvoiceId" from pgmq.q_mt_invoice_jobs order by msg_id`;
}

/** An order of one Frango Grelhado (R$ 18,90 × 2), in `status`, with `fulfillment`. */
async function makeOrder(
  status: string,
  fulfillment: "pickup" | "delivery",
  fixture = a,
): Promise<{ orderId: string; customerId: string }> {
  return db.begin(async (sql) => {
    const [c] = await sql<{ id: string }[]>`
      insert into public.customers (restaurant_id, name, phone)
      values (${fixture.restaurantId}, 'Joana', ${`+5511955${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`})
      returning id`;
    const fee = fulfillment === "delivery" ? 500 : 0;
    const [o] = await sql<{ id: string }[]>`
      insert into public.orders
        (restaurant_id, code, customer_id, status, fulfillment, logradouro, bairro, payment_method,
         subtotal_cents, delivery_fee_cents, total_cents, source)
      values (${fixture.restaurantId}, ${`ORD-${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`},
              ${c?.id}, ${status}, ${fulfillment},
              ${fulfillment === "delivery" ? "Rua A" : null}, ${fulfillment === "delivery" ? "Centro" : null},
              'pix', 3780, ${fee}, ${3780 + fee}, 'counter')
      returning id`;
    await sql`
      insert into public.order_items (restaurant_id, order_id, menu_item_id, name, size_name, unit_price_cents, qty)
      values (${fixture.restaurantId}, ${o?.id}, ${fixture.menuItemId}, 'Frango Grelhado', 'M', 1890, 2)`;
    return { orderId: o?.id as string, customerId: c?.id as string };
  });
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
  a = await seedRestaurant(db, "nf-a");
  b = await seedRestaurant(db, "nf-b");
  // Real sealed secrets through the settings service; the fake answers the test, so the row is connected.
  await saveFiscalConfig(deps, admin(), {
    baseUrl: "http://127.0.0.1:4020",
    apiKey: "nfk_test_integration",
    webhookSecret: WEBHOOK_SECRET,
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

describe("issueInvoice (FR-120..FR-125)", () => {
  test("a pickup order in pronto queues an NFC-e with the frozen payload and an issue job", async () => {
    const { orderId } = await makeOrder("pronto", "pickup");
    const r = await issueInvoice(deps, attendant(), { orderId });
    expect(r.outcome).toBe("queued");
    if (r.outcome !== "queued") return;
    expect(r.invoice).toMatchObject({ kind: "nfce", status: "queued", orderId });
    const [row] = await db<{ request_payload: { reference: string; kind: string }; created_by: string }[]>`
      select request_payload, created_by from public.order_invoices where id = ${r.invoice.id}`;
    expect(row?.request_payload.reference).toBe(r.invoice.id);
    expect(row?.request_payload.kind).toBe("nfce");
    expect(row?.created_by).toBe(a.attendantId);
    expect(await invoiceJobs()).toEqual([{ op: "issue", orderInvoiceId: r.invoice.id }]);
  });

  test("an order before pronto is blocked by V11 and creates nothing (FR-121)", async () => {
    const { orderId } = await makeOrder("preparando", "pickup");
    const r = await issueInvoice(deps, attendant(), { orderId });
    expect(r.outcome).toBe("blocked");
    if (r.outcome === "blocked") expect(r.problems.map((p) => p.code)).toContain("invoice_not_allowed");
    expect(await invoiceJobs()).toEqual([]);
  });

  test("a second Emitir NF while one is live is blocked (FR-132)", async () => {
    const { orderId } = await makeOrder("entregue", "pickup");
    expect((await issueInvoice(deps, attendant(), { orderId })).outcome).toBe("queued");
    const again = await issueInvoice(deps, attendant(), { orderId });
    expect(again.outcome).toBe("blocked");
    if (again.outcome === "blocked") expect(again.problems[0]?.code).toBe("invoice_already_active");
  });

  test("after an ambiguous failure, Emitir novamente resends the same row with the same key and body", async () => {
    const { orderId } = await makeOrder("entregue", "pickup");
    const first = await issueInvoice(deps, attendant(), { orderId });
    if (first.outcome !== "queued") throw new Error("expected queued");
    const [before] = await db<
      { p: unknown }[]
    >`select request_payload as p from public.order_invoices where id = ${first.invoice.id}`;
    await db`update public.order_invoices set status = 'failed', error_code = 'ambiguous' where id = ${first.invoice.id}`;
    await truncateQueues(db);
    // Another kind is ignored: the body is frozen under the key.
    const again = await issueInvoice(deps, attendant(), { orderId, kind: "nfe" });
    expect(again.outcome).toBe("queued");
    if (again.outcome !== "queued") return;
    expect(again.invoice.id).toBe(first.invoice.id);
    expect(again.invoice).toMatchObject({ status: "queued", kind: "nfce", errorCode: null });
    const rows = await db<{ id: string; p: unknown }[]>`
      select id, request_payload as p from public.order_invoices where order_id = ${orderId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.p).toEqual(before?.p);
    expect(await invoiceJobs()).toEqual([{ op: "issue", orderInvoiceId: first.invoice.id }]);
  });

  test("after a definitive failure (validation_failed) a new row with a new key is created", async () => {
    const { orderId } = await makeOrder("entregue", "pickup");
    const first = await issueInvoice(deps, attendant(), { orderId });
    if (first.outcome !== "queued") throw new Error("expected queued");
    await db`update public.order_invoices set status = 'failed', error_code = 'validation_failed' where id = ${first.invoice.id}`;
    const again = await issueInvoice(deps, attendant(), { orderId });
    expect(again.outcome).toBe("queued");
    if (again.outcome === "queued") expect(again.invoice.id).not.toBe(first.invoice.id);
  });

  test("after a rejected invoice the order can issue again with a new key (FR-132)", async () => {
    const { orderId } = await makeOrder("entregue", "pickup");
    const first = await issueInvoice(deps, attendant(), { orderId });
    if (first.outcome !== "queued") throw new Error("expected queued");
    await db`update public.order_invoices set status = 'rejected' where id = ${first.invoice.id}`;
    const second = await issueInvoice(deps, attendant(), { orderId });
    expect(second.outcome).toBe("queued");
    if (second.outcome === "queued") expect(second.invoice.id).not.toBe(first.invoice.id);
  });

  test("a delivery order without CPF and CEP lists the missing fields (FR-125, ADR-016)", async () => {
    const { orderId } = await makeOrder("saiu", "delivery");
    const r = await issueInvoice(deps, attendant(), { orderId });
    expect(r.outcome).toBe("blocked");
    if (r.outcome !== "blocked") return;
    expect(r.missingFields).toContain("customer.cpf_cnpj");
    expect(r.missingFields).toContain("address.cep");
    expect(r.missingFields).toContain("address.numero");
    // The restaurant's city, UF, and IBGE code fill the gaps (ADR-016).
    expect(r.missingFields).not.toContain("address.codigo_municipio");
  });

  test("the short form fills customer and order, then issues (FR-125)", async () => {
    const { orderId, customerId } = await makeOrder("saiu", "delivery");
    const r = await issueInvoice(deps, attendant(), {
      orderId,
      fill: { cpfCnpj: CPF, cep: "01310100", numero: "12" },
    });
    expect(r.outcome).toBe("queued");
    const [c] = await db<
      { cpf_cnpj: string; cep: string }[]
    >`select cpf_cnpj, cep from public.customers where id = ${customerId}`;
    expect(c).toEqual({ cpf_cnpj: CPF, cep: "01310100" });
    const [o] = await db<
      { cep: string; numero: string }[]
    >`select cep, numero from public.orders where id = ${orderId}`;
    expect(o).toEqual({ cep: "01310100", numero: "12" });
  });

  test("NF-e needs a CNPJ customer (FR-122, V10)", async () => {
    const { orderId, customerId } = await makeOrder("entregue", "pickup");
    const blocked = await issueInvoice(deps, attendant(), { orderId, kind: "nfe" });
    expect(blocked.outcome).toBe("blocked");
    await db`update public.customers set cpf_cnpj = ${CNPJ} where id = ${customerId}`;
    const r = await issueInvoice(deps, attendant(), {
      orderId,
      kind: "nfe",
      fill: { cep: "01310100", logradouro: "Av. Paulista", numero: "1000", bairro: "Bela Vista" },
    });
    expect(r.outcome).toBe("queued");
    if (r.outcome === "queued") expect(r.invoice.kind).toBe("nfe");
  });

  test("another restaurant's order is not found (NFR-001)", async () => {
    const { orderId } = await makeOrder("pronto", "pickup", b);
    await expect(issueInvoice(deps, attendant(), { orderId })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("applyInvoiceUpdate and the webhook (FR-126, FR-127, FR-136)", () => {
  async function queued(): Promise<string> {
    const { orderId } = await makeOrder("entregue", "pickup");
    const r = await issueInvoice(deps, attendant(), { orderId });
    if (r.outcome !== "queued") throw new Error("expected queued");
    await db`update public.order_invoices set external_id = ${`ext-${r.invoice.id}`} where id = ${r.invoice.id}`;
    return r.invoice.id;
  }
  const sys = () => ({ restaurantId: a.restaurantId, actorType: "system" as const });

  test("authorized stores numero and chave; a repeat changes nothing", async () => {
    const id = await queued();
    const first = await asService(db, sys(), (tx) =>
      applyInvoiceUpdate(tx, a.restaurantId, id, {
        status: "authorized",
        numero: 7,
        serie: 1,
        chaveAcesso: "4".repeat(44),
      }),
    );
    expect(first.changed).toBe(true);
    const again = await asService(db, sys(), (tx) =>
      applyInvoiceUpdate(tx, a.restaurantId, id, {
        status: "authorized",
        numero: 7,
        serie: 1,
        chaveAcesso: "4".repeat(44),
      }),
    );
    expect(again.changed).toBe(false);
    const back = await asService(db, sys(), (tx) =>
      applyInvoiceUpdate(tx, a.restaurantId, id, { status: "processing" }),
    );
    expect(back.changed).toBe(false);
  });

  test("a signed invoice.authorized delivery lands through the reference before external_id is known", async () => {
    const { orderId } = await makeOrder("entregue", "pickup");
    const r = await issueInvoice(deps, attendant(), { orderId });
    if (r.outcome !== "queued") throw new Error("expected queued");
    const body = JSON.stringify({
      id: "d-1",
      type: "invoice.authorized",
      created_at: NOW.toISOString(),
      data: {
        invoice: {
          id: "web-nf-1",
          kind: "nfce",
          status: "authorized",
          numero: 3,
          chave_acesso: "4".repeat(44),
          reference: r.invoice.id,
        },
      },
    });
    const t = Math.floor(NOW.getTime() / 1000);
    const reply = await receiveWebNfWebhook(createDbWebNfInboundStore(deps), {
      restaurantId: a.restaurantId,
      signatureHeader: signWebhook(WEBHOOK_SECRET, t, body),
      rawBody: new TextEncoder().encode(body),
      now: NOW,
    });
    expect(reply.status).toBe(200);
    const [row] = await db<{ status: string; external_id: string; numero: number }[]>`
      select status, external_id, numero from public.order_invoices where id = ${r.invoice.id}`;
    expect(row).toEqual({ status: "authorized", external_id: "web-nf-1", numero: 3 });
  });

  test("event.* queues a poll; an unknown invoice writes an audit row", async () => {
    const id = await queued();
    const ev = parseNfWebhookEvent({
      type: "event.rejected",
      data: { invoice: { id: `ext-${id}` }, event: { id: "e", type: "cancelamento", status: "rejected" } },
    });
    const res = await asService(db, sys(), (tx) => applyWebNfEvent(tx, a.restaurantId, ev));
    expect(res).toEqual({ action: "applied", changed: false, refreshQueued: true });
    expect((await invoiceJobs()).filter((j) => j.op === "poll" && j.orderInvoiceId === id)).toHaveLength(1);
    const unknown = parseNfWebhookEvent({ type: "invoice.authorized", data: { invoice: { id: "nope" } } });
    expect(await asService(db, sys(), (tx) => applyWebNfEvent(tx, a.restaurantId, unknown))).toEqual({
      action: "unknown_invoice",
    });
  });
});

describe("refresh, files, and cancel (FR-127, FR-129, FR-130, FR-135)", () => {
  async function authorized(): Promise<string> {
    const { orderId } = await makeOrder("entregue", "pickup");
    const r = await issueInvoice(deps, attendant(), { orderId });
    if (r.outcome !== "queued") throw new Error("expected queued");
    const created = await gateway.createInvoice(
      (await db<{ p: never }[]>`select request_payload as p from public.order_invoices where id = ${r.invoice.id}`)[0]
        ?.p as never,
      r.invoice.id,
    );
    await db`update public.order_invoices set external_id = ${created.id} where id = ${r.invoice.id}`;
    gateway.authorize(created.id, { numero: 9 });
    return r.invoice.id;
  }

  test("an attendant refreshes and gets fresh file URLs; nothing is stored", async () => {
    const id = await authorized();
    const view = await refreshInvoice(deps, attendant(), { orderInvoiceId: id });
    expect(view.status).toBe("authorized");
    const files = await getInvoiceFiles(deps, attendant(), { orderInvoiceId: id });
    expect(files.xmlUrl).toContain(".xml");
    expect(files.pdfUrl).toContain(".pdf");
    expect(files.cancelWarning).toContain("30 minutos");
    const [row] = await db<
      { t: string }[]
    >`select row_to_json(i)::text as t from public.order_invoices i where id = ${id}`;
    expect(row?.t).not.toContain("files.fake");
  });

  test("an attendant cannot cancel (FR-135, ADR-015)", async () => {
    const id = await authorized();
    await refreshInvoice(deps, attendant(), { orderInvoiceId: id });
    await expect(
      cancelInvoice(deps, attendant(), { orderInvoiceId: id, justificativa: "Pedido lançado em duplicidade" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  test("an admin cancel records the request and queues the cancel job", async () => {
    const id = await authorized();
    await refreshInvoice(deps, attendant(), { orderInvoiceId: id });
    const view = await cancelInvoice(deps, admin(), {
      orderInvoiceId: id,
      justificativa: "Pedido lançado em duplicidade",
    });
    expect(view.cancelRequestedAt).not.toBeNull();
    expect((await invoiceJobs()).some((j) => j.op === "cancel" && j.orderInvoiceId === id)).toBe(true);
    await expect(
      cancelInvoice(deps, admin(), { orderInvoiceId: id, justificativa: "Pedido lançado em duplicidade" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  test("a queued invoice cannot be cancelled", async () => {
    const { orderId } = await makeOrder("entregue", "pickup");
    const r = await issueInvoice(deps, attendant(), { orderId });
    if (r.outcome !== "queued") throw new Error("expected queued");
    await expect(
      cancelInvoice(deps, admin(), { orderInvoiceId: r.invoice.id, justificativa: "Pedido lançado em duplicidade" }),
    ).rejects.toMatchObject({ code: "invoice_not_allowed" });
  });

  test("getOrder lists the invoices and the card badge (FR-128, FR-139)", async () => {
    const { orderId } = await makeOrder("entregue", "pickup");
    await issueInvoice(deps, attendant(), { orderId });
    const detail = await getOrder(deps, attendant(), { orderId });
    expect(detail.invoices).toHaveLength(1);
    expect(detail.invoiceStatus).toBe("queued");
  });
});
