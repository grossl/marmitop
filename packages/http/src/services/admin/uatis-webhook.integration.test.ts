// covers FR-085, FR-170, FR-171, FR-172 (ADR-041), FR-173, FR-175, FR-176, FR-177, FR-178, FR-179 (ADR-021, ADR-023)
// Needs the local stack (`bun run dev:stack`) or TEST_DATABASE_URL.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { AppError, FakeGateway, GatewayError, parseUatisWebhookEvent, signWebhook } from "@mt/core";
import type { Db } from "@mt/db";
import { asService, createTestDb, type RestaurantFixture, seedRestaurant } from "@mt/db/test-harness";

import type { ServiceDeps } from "../../deps";
import { createTestServiceDeps, uatisWebhookBody, userCtx } from "../../testing";
import { createDbUatisInboundStore, receiveUatisWebhook } from "../whatsapp/inbound-webhook";
import { applyUatisEvent } from "../whatsapp/uatis-events";
import { connectWhatsApp } from "./integrations";
import { openSecret } from "./internal";
import { disableUatisWebhook, enableUatisWebhook, getUatisWebhookStatus, PUSH_REQUIRED_ERROR } from "./uatis-webhook";

const PUBLIC = "https://api.marmitop.example.com";
const NOW = new Date("2026-10-13T15:00:00Z");

let db: Db;
let gateway: FakeGateway;
let a: RestaurantFixture;
let b: RestaurantFixture;

const code = (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`);
const admin = (f = a) => userCtx(f.restaurantId, f.adminId, "admin");
const attendant = () => userCtx(a.restaurantId, a.attendantId, "attendant");
const depsWith = (publicUrl: string | undefined): ServiceDeps =>
  createTestServiceDeps(db, { gateways: { whatsapp: () => gateway, invoices: () => { throw new Error("unused"); } }, publicUrl });
const prodDepsWith = (publicUrl: string | undefined): ServiceDeps =>
  createTestServiceDeps(
    db,
    { gateways: { whatsapp: () => gateway, invoices: () => { throw new Error("unused"); } }, publicUrl },
    { env: "production" },
  );

interface IntegRow {
  uatis_webhook_id: string | null;
  uatis_webhook_mode: string | null;
  uatis_organization_id: string | null;
  uatis_feed_cursor: string | null;
  webhook_secret_id: string | null;
  last_webhook_at: Date | null;
}
async function integ(f = a): Promise<IntegRow> {
  const [row] = await db<IntegRow[]>`
    select uatis_webhook_id, uatis_webhook_mode, uatis_organization_id, uatis_feed_cursor, webhook_secret_id, last_webhook_at
    from public.integrations_whatsapp where restaurant_id = ${f.restaurantId}`;
  if (!row) throw new Error("no integration row");
  return row;
}

beforeAll(async () => {
  db = await createTestDb();
  a = await seedRestaurant(db, "uwh-a");
  b = await seedRestaurant(db, "uwh-b");
  // The fixture's secrets are not sealed by the test SecretBox; store real ones.
  gateway = new FakeGateway();
  for (const f of [a, b]) {
    await connectWhatsApp(depsWith(undefined), admin(f), {
      baseUrl: "https://uatis.example.test",
      apiKey: `obk_test_${f.restaurantId.slice(0, 8)}`,
      webhookSecret: "whsec_typed_by_hand_0000",
      phoneNumberId: "pn-1",
    });
  }
});

beforeEach(() => {
  gateway = new FakeGateway();
});

afterAll(async () => {
  await db.end();
});

describe("enableUatisWebhook", () => {
  test("a public MT_PUBLIC_URL registers push, seals the returned secret, and stores the ids", async () => {
    const deps = depsWith(PUBLIC);
    const before = await integ();
    await db`update public.integrations_whatsapp set uatis_feed_cursor = 'old' where restaurant_id = ${a.restaurantId}`;
    const result = await enableUatisWebhook(deps, admin(), undefined);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("push");
    const hook = gateway.webhooks.get(result.webhookId);
    expect(hook).toMatchObject({
      mode: "push",
      url: `${PUBLIC}/v1/webhooks/uatis/${a.restaurantId}`,
      events: ["message.created", "message.updated"],
    });
    expect(JSON.stringify(result)).not.toContain(hook?.secret ?? "x");

    const row = await integ();
    expect(row).toMatchObject({
      uatis_webhook_id: result.webhookId,
      uatis_webhook_mode: "push",
      uatis_organization_id: gateway.organization.id,
      uatis_feed_cursor: null,
    });
    expect(row.webhook_secret_id).not.toBe(before.webhook_secret_id);
    const opened = await asService(db, { restaurantId: a.restaurantId, actorType: "system" }, (tx) =>
      openSecret(tx, deps, { restaurantId: a.restaurantId, role: "admin", actorType: "system" }, row.webhook_secret_id ?? "", "uatis_webhook_secret"),
    );
    expect(opened).toBe(hook?.secret ?? "missing");
    const [old] = await db`select id from public.secrets where id = ${before.webhook_secret_id}`;
    expect(old).toBeUndefined();

    const [audit] = await db<{ context: Record<string, unknown> }[]>`
      select context from public.audit_logs where restaurant_id = ${a.restaurantId}
        and action = 'integration.whatsapp.webhook_enable' order by created_at desc limit 1`;
    expect(audit?.context).toMatchObject({ mode: "push", webhook_id: result.webhookId });
    expect(JSON.stringify(audit?.context)).not.toContain(hook?.secret ?? "x");
  });

  test.each([["http://localhost:3101"], ["https://10.0.0.5"], [undefined]])(
    "MT_PUBLIC_URL %p registers pull and keeps the stored secret",
    async (publicUrl) => {
      const deps = depsWith(publicUrl);
      const before = await integ();
      const result = await enableUatisWebhook(deps, admin(), undefined);
      expect(result).toMatchObject({ ok: true, mode: "pull" });
      if (!result.ok) return;
      expect(gateway.webhooks.get(result.webhookId)).toMatchObject({ mode: "pull", url: null, secret: null });
      const row = await integ();
      expect(row).toMatchObject({ uatis_webhook_mode: "pull", uatis_webhook_id: result.webhookId });
      expect(row.webhook_secret_id).toBe(before.webhook_secret_id);
    },
  );

  test("registering again deletes the previous webhook first (FR-171)", async () => {
    const deps = depsWith(PUBLIC);
    const first = await enableUatisWebhook(deps, admin(), undefined);
    const second = await enableUatisWebhook(deps, admin(), undefined);
    if (!first.ok || !second.ok) throw new Error("expected ok");
    expect(gateway.webhooks.size).toBe(1);
    expect(gateway.webhooks.has(second.webhookId)).toBe(true);
    const order = gateway.calls.map((c) => c.method).filter((m) => m === "deleteWebhook" || m === "createWebhook");
    expect(order.slice(-2)).toEqual(["deleteWebhook", "createWebhook"]);
  });

  test("a stored webhook that backend-uatis no longer has (404) is fine", async () => {
    const deps = depsWith(PUBLIC);
    await db`update public.integrations_whatsapp set uatis_webhook_id = gen_random_uuid(), uatis_webhook_mode = 'push'
             where restaurant_id = ${a.restaurantId}`;
    const result = await enableUatisWebhook(deps, admin(), undefined);
    expect(result.ok).toBe(true);
  });

  test("a refused create (403) returns pt-BR text and clears the webhook columns", async () => {
    const deps = depsWith(PUBLIC);
    await enableUatisWebhook(deps, admin(), undefined);
    gateway.failNext("createWebhook", GatewayError.http(403, "forbidden"));
    const result = await enableUatisWebhook(deps, admin(), undefined);
    expect(result).toEqual({
      ok: false,
      error: "A chave da API do Uatis precisa ser de administrador.",
    });
    expect(await integ()).toMatchObject({ uatis_webhook_id: null, uatis_webhook_mode: null, uatis_organization_id: null });
  });

  test.each([["http://localhost:3101"], ["https://10.0.0.5"], [undefined]])(
    "production with MT_PUBLIC_URL %p refuses pull, calls nothing, and keeps the stored webhook (ADR-041)",
    async (publicUrl) => {
      await enableUatisWebhook(depsWith(PUBLIC), admin(), undefined);
      const before = await integ();
      gateway = new FakeGateway();
      const result = await enableUatisWebhook(prodDepsWith(publicUrl), admin(), undefined);
      expect(result).toEqual({ ok: false, error: PUSH_REQUIRED_ERROR });
      expect(gateway.calls).toEqual([]);
      expect(await integ()).toEqual(before);
    },
  );

  test("production with a public MT_PUBLIC_URL registers push (ADR-041)", async () => {
    const result = await enableUatisWebhook(prodDepsWith(PUBLIC), admin(), undefined);
    expect(result).toMatchObject({ ok: true, mode: "push" });
  });

  test("an attendant is refused (FR-179)", async () => {
    const deps = depsWith(PUBLIC);
    expect(code(await enableUatisWebhook(deps, attendant(), undefined).catch((e) => e))).toBe("forbidden");
    expect(code(await disableUatisWebhook(deps, attendant(), undefined).catch((e) => e))).toBe("forbidden");
    expect(code(await getUatisWebhookStatus(deps, attendant(), undefined).catch((e) => e))).toBe("forbidden");
  });

  test("without a WhatsApp integration it answers whatsapp_not_configured", async () => {
    const c = await seedRestaurant(db, "uwh-c");
    await db`delete from public.integrations_whatsapp where restaurant_id = ${c.restaurantId}`;
    const deps = depsWith(PUBLIC);
    expect(code(await enableUatisWebhook(deps, admin(c), undefined).catch((e) => e))).toBe("whatsapp_not_configured");
  });
});

describe("disableUatisWebhook (FR-173)", () => {
  test("deletes the webhook, clears the columns, keeps the secret, and audits", async () => {
    const deps = depsWith(PUBLIC);
    const enabled = await enableUatisWebhook(deps, admin(), undefined);
    if (!enabled.ok) throw new Error("expected ok");
    const secretId = (await integ()).webhook_secret_id;
    expect(await disableUatisWebhook(deps, admin(), undefined)).toEqual({ ok: true });
    expect(gateway.webhooks.size).toBe(0);
    expect(await integ()).toMatchObject({
      uatis_webhook_id: null,
      uatis_webhook_mode: null,
      uatis_organization_id: null,
      uatis_feed_cursor: null,
      webhook_secret_id: secretId,
    });
    const [audit] = await db`select 1 from public.audit_logs where restaurant_id = ${a.restaurantId}
      and action = 'integration.whatsapp.webhook_disable'`;
    expect(audit).toBeDefined();
  });

  test("a gateway failure leaves the row as it was", async () => {
    const deps = depsWith(PUBLIC);
    const enabled = await enableUatisWebhook(deps, admin(), undefined);
    if (!enabled.ok) throw new Error("expected ok");
    gateway.failNext("deleteWebhook", GatewayError.http(500));
    const result = await disableUatisWebhook(deps, admin(), undefined);
    expect(result.ok).toBe(false);
    expect((await integ()).uatis_webhook_id).toBe(enabled.webhookId);
  });
});

describe("getUatisWebhookStatus (FR-178)", () => {
  test("not registered: says which mode the next activation picks", async () => {
    await disableUatisWebhook(depsWith(undefined), admin(), undefined);
    const status = await getUatisWebhookStatus(depsWith("http://localhost:3101"), admin(), undefined);
    expect(status).toMatchObject({
      state: "not_registered",
      mode: null,
      nextMode: "pull",
      publicUrl: { ok: false, reason: "not_https" },
      deliveries: null,
    });
    const pushNext = await getUatisWebhookStatus(depsWith(PUBLIC), admin(), undefined);
    expect(pushNext).toMatchObject({ nextMode: "push", publicUrl: { ok: true, url: PUBLIC } });
  });

  test("active: mode, the five newest attempts, and the last push time", async () => {
    const deps = depsWith(PUBLIC);
    const enabled = await enableUatisWebhook(deps, admin(), undefined);
    if (!enabled.ok) throw new Error("expected ok");
    const attempts = Array.from({ length: 7 }, (_, i) => ({
      id: crypto.randomUUID(),
      eventType: "message.created",
      status: "delivered" as const,
      attemptNo: 1,
      httpStatus: 200,
      durationMs: 10,
      createdAt: new Date(NOW.getTime() - i * 1000),
      deliveredAt: null,
    }));
    gateway.deliveries.set(enabled.webhookId, attempts);
    await db`update public.integrations_whatsapp set last_webhook_at = ${NOW} where restaurant_id = ${a.restaurantId}`;
    const status = await getUatisWebhookStatus(deps, admin(), undefined);
    expect(status).toMatchObject({ state: "active", mode: "push", webhookId: enabled.webhookId, deliveriesError: null });
    expect(status.lastWebhookAt).toBe(NOW.toISOString());
    expect(status.deliveries?.map((d) => d.id)).toEqual(attempts.slice(0, 5).map((d) => d.id));
  });

  test("pushRequired is true in production only, so a leftover pull webhook gets a warning (ADR-041)", async () => {
    const enabled = await enableUatisWebhook(depsWith(undefined), admin(), undefined);
    expect(enabled).toMatchObject({ ok: true, mode: "pull" });
    const prod = await getUatisWebhookStatus(prodDepsWith(PUBLIC), admin(), undefined);
    expect(prod).toMatchObject({ state: "active", mode: "pull", pushRequired: true, nextMode: "push" });
    const dev = await getUatisWebhookStatus(depsWith(undefined), admin(), undefined);
    expect(dev).toMatchObject({ mode: "pull", pushRequired: false });
  });

  test("a gateway failure shows a note instead of the attempts and never throws", async () => {
    const deps = depsWith(PUBLIC);
    await enableUatisWebhook(deps, admin(), undefined);
    gateway.failNext("listWebhookDeliveries", GatewayError.timeout());
    const status = await getUatisWebhookStatus(deps, admin(), undefined);
    expect(status.state).toBe("active");
    expect(status.deliveries).toBeNull();
    expect(status.deliveriesError).toBe("Não foi possível ler as entregas do backend-uatis.");
  });
});

describe("connectWhatsApp without a webhook secret (FR-085)", () => {
  test("a first connect may omit the webhook secret; the push route then answers 401", async () => {
    const c = await seedRestaurant(db, "uwh-d");
    await db`delete from public.integrations_whatsapp where restaurant_id = ${c.restaurantId}`;
    const deps = depsWith(undefined);
    const result = await connectWhatsApp(deps, admin(c), {
      baseUrl: "https://uatis.example.test",
      apiKey: "obk_test_d",
      phoneNumberId: "pn-d",
    });
    expect(result.status).toBe("connected");
    expect((await integ(c)).webhook_secret_id).toBeNull();
    expect(await createDbUatisInboundStore(deps).loadVerification(c.restaurantId)).toBeNull();
  });
});

describe("push route against the database (FR-175, FR-176, FR-177)", () => {
  async function pushSetup() {
    const deps = depsWith(PUBLIC);
    const enabled = await enableUatisWebhook(deps, admin(b), undefined);
    if (!enabled.ok) throw new Error("expected ok");
    const secret = gateway.webhooks.get(enabled.webhookId)?.secret ?? "";
    return { deps, secret };
  }
  const phone = () => `5511960${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
  function inboundBody(org: string, deliveryId = crypto.randomUUID(), messageId = crypto.randomUUID(), from = phone()) {
    return uatisWebhookBody({
      type: "message.created",
      organizationId: org,
      deliveryId,
      row: {
        id: messageId,
        conversation_id: crypto.randomUUID(),
        direction: "in",
        content: { version: "1", type: "text", kind: "text", text: "Oi pelo push" },
        status: { state: "received", errors: [] },
        contact_address: from,
        created_at: new Date(NOW.getTime() - 1000).toISOString(),
      },
    });
  }
  const send = (deps: ServiceDeps, secret: string, raw: string, delivery?: string) =>
    receiveUatisWebhook(createDbUatisInboundStore(deps), {
      restaurantId: b.restaurantId,
      signatureHeader: signWebhook(secret, Math.floor(NOW.getTime() / 1000), raw),
      deliveryHeader: delivery ?? (JSON.parse(raw) as { id: string }).id,
      rawBody: new TextEncoder().encode(raw),
      now: NOW,
    });

  test("an inbound push lands in messages once, records the receipt, and sets last_webhook_at", async () => {
    const { deps, secret } = await pushSetup();
    const messageId = crypto.randomUUID();
    const raw = inboundBody(gateway.organization.id, undefined, messageId);
    expect((await send(deps, secret, raw)).status).toBe(200);
    expect((await send(deps, secret, raw)).status).toBe(200);
    const rows = await db`select id from public.messages where restaurant_id = ${b.restaurantId} and external_id = ${messageId}`;
    expect(rows).toHaveLength(1);
    const [receipt] = await db<{ source: string }[]>`
      select source from public.uatis_event_receipts where restaurant_id = ${b.restaurantId}
        and event_id = ${(JSON.parse(raw) as { id: string }).id}`;
    expect(receipt?.source).toBe("push");
    expect((await integ(b)).last_webhook_at).toEqual(NOW);
  });

  test("another organization is 401 and writes nothing", async () => {
    const { deps, secret } = await pushSetup();
    const messageId = crypto.randomUUID();
    const res = await send(deps, secret, inboundBody(crypto.randomUUID(), undefined, messageId));
    expect(res.status).toBe(401);
    const rows = await db`select id from public.messages where external_id = ${messageId}`;
    expect(rows).toHaveLength(0);
  });

  test("an event first read from the feed is a duplicate when pushed (dedupe across push and pull)", async () => {
    const { deps, secret } = await pushSetup();
    const deliveryId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const raw = inboundBody(gateway.organization.id, deliveryId, messageId);
    const pulled = await asService(db, { restaurantId: b.restaurantId, actorType: "system" }, (tx) =>
      applyUatisEvent(tx, deps, b.restaurantId, parseUatisWebhookEvent(JSON.parse(raw)), { eventId: deliveryId, source: "pull" }),
    );
    expect(pulled.action).toBe("ingested");
    const [conv] = await db<{ unread_count: number }[]>`
      select c.unread_count from public.conversations c join public.messages m on m.conversation_id = c.id
      where m.external_id = ${messageId}`;
    expect((await send(deps, secret, raw)).status).toBe(200);
    const [after] = await db<{ unread_count: number }[]>`
      select c.unread_count from public.conversations c join public.messages m on m.conversation_id = c.id
      where m.external_id = ${messageId}`;
    expect(after?.unread_count).toBe(conv?.unread_count ?? -1);
  });

  test("message.updated failed stores whatsapp_<code> and the title on a known outbound message", async () => {
    const { deps, secret } = await pushSetup();
    const externalId = crypto.randomUUID();
    await db`
      insert into public.messages (restaurant_id, conversation_id, direction, body, status, external_id)
      values (${b.restaurantId}, ${b.conversationId}, 'out', 'Olá', 'sent', ${externalId})`;
    const raw = uatisWebhookBody({
      type: "message.updated",
      organizationId: gateway.organization.id,
      row: {
        id: externalId,
        conversation_id: crypto.randomUUID(),
        direction: "out",
        content: {},
        status: { state: "failed", errors: [{ code: 131047, title: "Re-engagement message", message: "x", details: null }] },
        contact_address: "5511999990000",
        created_at: NOW.toISOString(),
      },
    });
    expect((await send(deps, secret, raw)).status).toBe(200);
    const [row] = await db<{ status: string; error_code: string; error_message: string }[]>`
      select status, error_code, error_message from public.messages where external_id = ${externalId}`;
    expect(row).toEqual({ status: "failed", error_code: "whatsapp_131047", error_message: "Re-engagement message" });
  });

  test("sent then delivered then read ends at read", async () => {
    const { deps, secret } = await pushSetup();
    const externalId = crypto.randomUUID();
    await db`
      insert into public.messages (restaurant_id, conversation_id, direction, body, status, external_id)
      values (${b.restaurantId}, ${b.conversationId}, 'out', 'Olá', 'sent', ${externalId})`;
    for (const state of ["delivered", "read", "delivered"]) {
      const raw = uatisWebhookBody({
        type: "message.updated",
        organizationId: gateway.organization.id,
        row: {
          id: externalId,
          conversation_id: crypto.randomUUID(),
          direction: "out",
          content: { version: "1", type: "text", kind: "text", text: "Olá" },
          status: { state, errors: [] },
          contact_address: "5511999990000",
          created_at: NOW.toISOString(),
        },
      });
      expect((await send(deps, secret, raw)).status).toBe(200);
    }
    const [row] = await db<{ status: string }[]>`select status from public.messages where external_id = ${externalId}`;
    expect(row?.status).toBe("read");
  });
});
