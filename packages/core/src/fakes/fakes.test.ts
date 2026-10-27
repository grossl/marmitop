// covers FR-100, FR-101, FR-116, FR-124, FR-147, FR-150, FR-151, FR-152, FR-156, NFR-022
import { describe, expect, test } from "bun:test";
import { NullBillingProvider, RecordingBillingProvider } from "../billing/billing-providers";
import { buildInvoiceRequest } from "../fiscal/invoice-request";
import type { BillingProvider } from "../ports/billing-provider";
import { GatewayError } from "../ports/gateway-error";
import { signWebhook, verifySignature } from "../webhook-signature";
import { FakeGateway } from "./fake-gateway";
import { FakeInvoiceGateway } from "./fake-invoice-gateway";
import { FakeWebhookSender } from "./fake-webhook-sender";
import { FixedClock } from "./fixed-clock";

describe("FixedClock", () => {
  test("advance and set move the time", () => {
    const c = new FixedClock("2026-10-13T12:00:00Z");
    c.advance(60_000);
    expect(c.now().toISOString()).toBe("2026-10-13T12:01:00.000Z");
    c.set("2026-01-01T00:00:00Z");
    expect(c.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("FakeGateway", () => {
  const input = { to: "+5511999990000", fromAddress: "pn-1", body: "oi" };

  test("records calls and sent messages", async () => {
    const g = new FakeGateway({ clock: new FixedClock("2026-10-13T12:00:00Z") });
    await g.sendText(input);
    await g.sendTemplate({ to: input.to, fromAddress: "pn-1", templateName: "t", language: "pt_BR" });
    expect(g.sentTexts).toEqual([input]);
    expect(g.sentTemplates.length).toBe(1);
    expect(g.calls.map((c) => c.method)).toEqual(["sendText", "sendTemplate"]);
  });

  test("a scripted answer overrides the default, once", async () => {
    const g = new FakeGateway();
    g.scriptNextSend({ result: { externalId: "wamid-1", status: "sent" } });
    expect(await g.sendText(input)).toEqual({ externalId: "wamid-1", status: "sent" });
    const second = await g.sendText(input);
    expect(second.externalId).not.toBe("wamid-1");
    expect(second.status).toBe("pending");
  });

  test("a scripted failure throws and records no sent message", async () => {
    const g = new FakeGateway();
    g.failNextSend(GatewayError.http(422, "outside_service_window"));
    await expect(g.sendText(input)).rejects.toMatchObject({
      failure: { kind: "http", status: 422, code: "outside_service_window" },
    });
    expect(g.sentTexts.length).toBe(0);
    await expect(g.sendText(input)).resolves.toBeDefined();
  });

  test("a scripted delay waits", async () => {
    const g = new FakeGateway();
    g.scriptNextSend({ delayMs: 25 });
    const t0 = Date.now();
    await g.sendText(input);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(20);
  });

  test("simulateInbound creates a delivered inbound message others can poll (FR-116)", async () => {
    const clock = new FixedClock("2026-10-13T12:00:00Z");
    const g = new FakeGateway({ clock });
    const m = g.simulateInbound({ from: "(11) 98888-7777", body: "quero uma marmita" });
    expect(m).toMatchObject({
      direction: "in",
      status: "delivered",
      contactAddress: "+5511988887777",
      body: "quero uma marmita",
    });
    const page = await g.listMessages({ direction: "in", from: new Date("2026-10-13T11:59:00Z") });
    expect(page.items.map((x) => x.externalId)).toEqual([m.externalId]);
  });

  test("setMessageStatus moves a stored message, as message.updated would", async () => {
    const g = new FakeGateway();
    const sent = await g.sendText(input);
    g.setMessageStatus(sent.externalId, "read");
    const page = await g.listMessages({ direction: "out" });
    expect(page.items[0]?.status).toBe("read");
  });

  test("paging returns a cursor until the last page", async () => {
    const g = new FakeGateway();
    for (let i = 0; i < 5; i++) g.simulateInbound({ from: "+5511988887777", body: `m${i}` });
    const p1 = await g.listMessages({ limit: 2 });
    const p2 = await g.listMessages({ limit: 2, cursor: p1.nextCursor });
    const p3 = await g.listMessages({ limit: 2, cursor: p2.nextCursor });
    expect([p1.items.length, p2.items.length, p3.items.length]).toEqual([2, 2, 1]);
    expect(p3.nextCursor).toBeNull();
  });

  test("connection and templates are scriptable", async () => {
    const g = new FakeGateway();
    g.templates = [{ name: "pedido", language: "pt_BR" }];
    g.setConnection({ ok: false, error: "unauthorized" });
    expect(await g.listApprovedTemplates()).toEqual([{ name: "pedido", language: "pt_BR" }]);
    expect(await g.testConnection()).toEqual({ ok: false, error: "unauthorized" });
  });
});

describe("FakeInvoiceGateway", () => {
  const payload = buildOk();

  function buildOk() {
    const r = buildInvoiceRequest(
      {
        code: "ORD-1",
        status: "finalizado",
        fulfillment: "pickup",
        paymentMethod: "pix",
        changeForCents: null,
        deliveryFeeCents: 0,
        totalCents: 2500,
      },
      [{ menuItemId: null, name: "Marmita", sizeName: null, unitPriceCents: 2500, qty: 1 }],
      { name: "Ana", cpfCnpj: null },
      {
        baseUrl: "https://nf",
        apiKeyConfigured: true,
        nfceSerie: 1,
        nfeSerie: 1,
        defaultNcm: "21069090",
        defaultCfop: "5101",
        defaultCsosn: "102",
        defaultPisCst: "49",
        defaultCofinsCst: "49",
        deliveryFeeMode: "item",
      },
      [],
      "nfce",
    );
    if (!r.ok) throw new Error("fixture must build");
    return r.request;
  }

  test("authorize moves an invoice to a final state with files", async () => {
    const g = new FakeInvoiceGateway();
    const { id } = await g.createInvoice(payload, "k1");
    g.authorize(id, { numero: 77 });
    const view = await g.getInvoice(id);
    expect(view).toMatchObject({ status: "authorized", numero: 77 });
    expect(view.files?.xml).toContain(".xml");
    expect(await g.cancelInvoice(id, "Pedido lançado em duplicidade", "c1")).toEqual({ status: "cancelled" });
    expect((await g.getInvoice(id)).status).toBe("cancelled");
  });

  test("cancel checks the justification length", async () => {
    const g = new FakeInvoiceGateway();
    const { id } = await g.createInvoice(payload, "k1");
    g.authorize(id);
    await expect(g.cancelInvoice(id, "curto", "c1")).rejects.toMatchObject({ failure: { status: 422 } });
  });

  test("a scripted failure throws once; a retry with the same key then succeeds (FR-137)", async () => {
    const g = new FakeInvoiceGateway();
    g.failNextCreate(GatewayError.timeout());
    await expect(g.createInvoice(payload, "k1")).rejects.toBeInstanceOf(GatewayError);
    const ok = await g.createInvoice(payload, "k1");
    expect(ok.replayed).toBe(false);
    expect(g.calls.filter((c) => c.method === "createInvoice").length).toBe(2);
  });

  test("a frozen payload resent unchanged is a replay, not a conflict", async () => {
    const g = new FakeInvoiceGateway();
    const frozen = JSON.parse(JSON.stringify(payload));
    const a = await g.createInvoice(payload, "k1");
    const b = await g.createInvoice(frozen, "k1");
    expect(b).toEqual({ id: a.id, status: "queued", replayed: true });
  });

  test("scripted create result and connection", async () => {
    const g = new FakeInvoiceGateway();
    g.scriptNextCreate({ result: { id: "inv-9", status: "processing" } });
    expect(await g.createInvoice(payload, "k9")).toEqual({ id: "inv-9", status: "processing", replayed: false });
    g.setConnection({ ok: false, error: "down" });
    expect(await g.testConnection()).toEqual({ ok: false, error: "down" });
  });
});

describe("FakeWebhookSender", () => {
  test("records signed headers that a receiver verifies (FR-147)", async () => {
    const clock = new FixedClock("2026-10-13T12:00:00Z");
    const s = new FakeWebhookSender({ clock });
    const body = '{"id":"d-1"}';
    await s.send({ url: "https://x", secret: "sec", event: "order.created", deliveryId: "d-1", body });
    const rec = s.deliveries[0];
    expect(rec?.headers["X-Marmitop-Event"]).toBe("order.created");
    expect(rec?.headers["X-Marmitop-Signature"]).toBe(signWebhook("sec", 1_791_892_800, body));
    expect(
      verifySignature({ header: rec?.headers["X-Marmitop-Signature"], rawBody: body, secret: "sec", now: clock.now() })
        .ok,
    ).toBe(true);
  });

  test("scripted status codes and errors", async () => {
    const s = new FakeWebhookSender();
    s.scriptNext({ statusCode: 500 }).scriptNext({ error: GatewayError.timeout() });
    const d = { url: "https://x", secret: "s", event: "e", deliveryId: "d", body: "{}" };
    expect((await s.send(d)).statusCode).toBe(500);
    await expect(s.send(d)).rejects.toBeInstanceOf(GatewayError);
    expect((await s.send(d)).statusCode).toBe(200);
  });
});

describe("BillingProvider swap (FR-151)", () => {
  // a caller written against the port only
  async function onOrderCreated(billing: BillingProvider, restaurantId: string, orderId: string) {
    await billing.recordUsage({
      restaurantId,
      kind: "order.created",
      refId: orderId,
      occurredAt: new Date("2026-10-13T12:00:00Z"),
    });
    return billing.getPlan(restaurantId);
  }

  test("NullBillingProvider and a test double give the caller the same behavior", async () => {
    const written: string[] = [];
    const plan = {
      code: "free",
      name: "Gratuito",
      includedOrdersMonth: 1,
      includedMessagesMonth: 1,
      includedInvoicesMonth: 1,
      priceDisplay: "",
    };
    const nul = new NullBillingProvider({
      loadPlan: async () => plan,
      writeUsage: async (e) => void written.push(e.refId),
    });
    const rec = new RecordingBillingProvider();
    rec.plans.set("r1", plan);
    expect(await onOrderCreated(nul, "r1", "o1")).toEqual(plan);
    expect(await onOrderCreated(rec, "r1", "o1")).toEqual(plan);
    expect(written).toEqual(["o1"]);
    expect(rec.usage.length).toBe(1);
  });

  test("the recording double counts one event per (kind, ref), never twice (FR-152)", async () => {
    const rec = new RecordingBillingProvider();
    const e = { restaurantId: "r1", kind: "message.sent" as const, refId: "m1", occurredAt: new Date() };
    await rec.recordUsage(e);
    await rec.recordUsage(e);
    expect(rec.usage.length).toBe(1);
  });

  test("NullBillingProvider lists no invoices and drops usage without a sink", async () => {
    const nul = new NullBillingProvider({ loadPlan: async () => null });
    expect(await nul.listInvoices("r1")).toEqual([]);
    expect(await nul.getPlan("r1")).toBeNull();
    await expect(
      nul.recordUsage({ restaurantId: "r1", kind: "order.created", refId: "o", occurredAt: new Date() }),
    ).resolves.toBeUndefined();
  });
});
