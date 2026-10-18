// covers FR-010, FR-011, FR-012, FR-013, FR-014, FR-019, FR-040, FR-041, FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049, FR-117, FR-006, NFR-001
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AppError } from "@mt/core";
import type { Db } from "@mt/db";
import { createTestDb, type RestaurantFixture, seedRestaurant } from "@mt/db/test-harness";

import type { ServiceDeps } from "../../deps";
import { createTestServiceDeps, userCtx } from "../../testing";
import {
  createCustomer,
  getConversation,
  getCustomer,
  listConversations,
  listCustomers,
  markConversationRead,
  retryMessage,
  sendMessage,
  simulateInboundMessage,
  updateCustomer,
} from "./index";

let db: Db;
let deps: ServiceDeps;
let a: RestaurantFixture;
let b: RestaurantFixture;

const code = (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`);
const admin = () => userCtx(a.restaurantId, a.adminId, "admin");
const attendant = () => userCtx(a.restaurantId, a.attendantId, "attendant");
// The test clock is fixed at 2026-10-13T15:00:00Z.
const NOW = new Date("2026-10-13T15:00:00Z");

async function queueDepth(): Promise<number> {
  const [row] = await db<{ n: number }[]>`select count(*)::int as n from pgmq.q_mt_outbound_messages`;
  return row?.n ?? 0;
}

beforeAll(async () => {
  db = await createTestDb();
  deps = createTestServiceDeps(db);
  a = await seedRestaurant(db, "msg-a");
  b = await seedRestaurant(db, "msg-b");
  await db`update public.conversations set last_inbound_at = ${new Date(NOW.getTime() - 3600_000)}
           where id = ${a.conversationId}`;
  // The fixture's welcome goes out 1 ms after the first inbound (FR-110). On the fixed clock it
  // stays the newest message, so it would own the preview. whatsapp.integration.test.ts covers it.
  await db`update public.automatic_messages set enabled = false where restaurant_id = ${a.restaurantId}`;
});

afterAll(async () => {
  await db.end();
});

describe("simulateInboundMessage", () => {
  test("a new phone creates a customer, a conversation, and an unread inbound message", async () => {
    const r = await simulateInboundMessage(deps, admin(), { phone: "(11) 98888-7777", body: "Oi, tem marmita?" });
    const [conv] = await db<{ unread_count: number; last_message_preview: string; last_inbound_at: Date }[]>`
      select unread_count, last_message_preview, last_inbound_at from public.conversations where id = ${r.conversationId}`;
    expect(conv?.unread_count).toBe(1);
    expect(conv?.last_message_preview).toBe("Oi, tem marmita?");
    expect(conv?.last_inbound_at.toISOString()).toBe(NOW.toISOString());
    const [msg] = await db<{ direction: string; status: string; external_id: string }[]>`
      select direction, status, external_id from public.messages where id = ${r.messageId}`;
    expect(msg).toMatchObject({ direction: "in", status: "delivered" });
    expect(msg?.external_id.startsWith("sim-")).toBe(true);
    const [cust] = await db<{ phone: string }[]>`select phone from public.customers where id = ${r.customerId}`;
    expect(cust?.phone).toBe("+5511988887777");
  });

  test("a known phone reuses the customer and adds one to the unread count", async () => {
    const first = await simulateInboundMessage(deps, admin(), { phone: "+5511977776666", body: "um" });
    const second = await simulateInboundMessage(deps, admin(), { phone: "+5511977776666", body: "dois" });
    expect(second.customerId).toBe(first.customerId);
    expect(second.conversationId).toBe(first.conversationId);
    const [conv] = await db<{ unread_count: number }[]>`
      select unread_count from public.conversations where id = ${first.conversationId}`;
    expect(conv?.unread_count).toBe(2);
  });

  test("an attendant is refused", async () => {
    const e = await simulateInboundMessage(deps, attendant(), { phone: "+5511966665555", body: "x" }).catch((x) => x);
    expect(code(e)).toBe("forbidden");
  });

  test("production refuses", async () => {
    const prod = { ...deps, env: "production" as const };
    const e = await simulateInboundMessage(prod, admin(), { phone: "+5511966665555", body: "x" }).catch((x) => x);
    expect(code(e)).toBe("forbidden");
  });

  test("restaurant B does not see A's simulated customers", async () => {
    const list = await listCustomers(deps, userCtx(b.restaurantId, b.adminId, "admin"), { q: "98888" });
    expect(list.items).toHaveLength(0);
  });
});

describe("listConversations", () => {
  test("lists newest first with name, preview, unread (FR-010)", async () => {
    const { items } = await listConversations(deps, attendant(), {});
    expect(items.length).toBeGreaterThanOrEqual(3);
    const times = items.map((i) => i.lastMessageAt ?? "");
    expect([...times].sort().reverse()).toEqual(times);
    expect(items.some((i) => i.unreadCount > 0)).toBe(true);
  });

  test("searches by phone and by preview text (FR-011)", async () => {
    expect((await listConversations(deps, attendant(), { q: "98888" })).items).toHaveLength(1);
    expect((await listConversations(deps, attendant(), { q: "tem marmita" })).items).toHaveLength(1);
    expect((await listConversations(deps, attendant(), { q: "%" })).items).toHaveLength(0);
  });

  test("never returns another restaurant's conversation (NFR-001)", async () => {
    const { items } = await listConversations(deps, userCtx(b.restaurantId, b.adminId, "admin"), {});
    expect(items.some((i) => i.id === a.conversationId)).toBe(false);
  });
});

describe("getConversation and markConversationRead", () => {
  test("opening resets unread to zero and returns messages in order (FR-012, FR-013)", async () => {
    const { items } = await listConversations(deps, attendant(), { q: "dois" });
    const target = items.find((i) => i.unreadCount > 0);
    expect(target).toBeDefined();
    const detail = await getConversation(deps, attendant(), { conversationId: target!.id });
    expect(detail.conversation.unreadCount).toBe(0);
    expect(detail.windowOpen).toBe(true);
    const created = detail.messages.map((m) => m.createdAt);
    expect([...created].sort()).toEqual(created);
    const [row] = await db<{ unread_count: number }[]>`select unread_count from public.conversations where id = ${target!.id}`;
    expect(row?.unread_count).toBe(0);
  });

  test("lists the customer's orders with the order tag data (FR-016, FR-018)", async () => {
    const detail = await getConversation(deps, attendant(), { conversationId: a.conversationId });
    expect(detail.orders.map((o) => o.code)).toContain("ORD-001");
    expect(detail.orders[0]?.items.length).toBeGreaterThan(0);
  });

  test("another restaurant's conversation is not found", async () => {
    const e = await getConversation(deps, userCtx(b.restaurantId, b.adminId, "admin"), {
      conversationId: a.conversationId,
    }).catch((x) => x);
    expect(code(e)).toBe("not_found");
    const e2 = await markConversationRead(deps, userCtx(b.restaurantId, b.adminId, "admin"), {
      conversationId: a.conversationId,
    }).catch((x) => x);
    expect(code(e2)).toBe("not_found");
  });
});

describe("sendMessage and retryMessage", () => {
  test("stores a pending message, updates the preview, and enqueues one job (FR-014)", async () => {
    const before = await queueDepth();
    const r = await sendMessage(deps, attendant(), {
      conversationId: a.conversationId,
      body: "  Seu pedido saiu.  ",
      orderId: a.orderId,
    });
    const [msg] = await db<{ direction: string; status: string; body: string; order_id: string; sent_by: string }[]>`
      select direction, status, body, order_id, sent_by from public.messages where id = ${r.messageId}`;
    expect(msg).toMatchObject({
      direction: "out",
      status: "pending",
      body: "Seu pedido saiu.",
      order_id: a.orderId,
      sent_by: a.attendantId,
    });
    expect(await queueDepth()).toBe(before + 1);
    const [conv] = await db<{ last_message_preview: string }[]>`
      select last_message_preview from public.conversations where id = ${a.conversationId}`;
    expect(conv?.last_message_preview).toBe("Seu pedido saiu.");
  });

  test("outside the 24-hour window nothing is stored or enqueued (FR-117)", async () => {
    await db`update public.conversations set last_inbound_at = ${new Date(NOW.getTime() - 25 * 3600_000)}
             where id = ${a.conversationId}`;
    const before = await queueDepth();
    const [{ n: msgsBefore } = { n: 0 }] = await db<{ n: number }[]>`select count(*)::int as n from public.messages`;
    const e = await sendMessage(deps, attendant(), { conversationId: a.conversationId, body: "oi" }).catch((x) => x);
    expect(code(e)).toBe("outside_service_window");
    expect(await queueDepth()).toBe(before);
    const [{ n: msgsAfter } = { n: 0 }] = await db<{ n: number }[]>`select count(*)::int as n from public.messages`;
    expect(msgsAfter).toBe(msgsBefore);
    await db`update public.conversations set last_inbound_at = ${new Date(NOW.getTime() - 3600_000)}
             where id = ${a.conversationId}`;
  });

  test("rejects an order of another customer or restaurant, and a blank body", async () => {
    const e = await sendMessage(deps, attendant(), {
      conversationId: a.conversationId,
      body: "x",
      orderId: b.orderId,
    }).catch((x) => x);
    expect(code(e)).toBe("validation_failed");
    const e2 = await sendMessage(deps, attendant(), { conversationId: a.conversationId, body: "   " }).catch((x) => x);
    expect(code(e2)).toBe("validation_failed");
  });

  test("restaurant B cannot send into A's conversation", async () => {
    const e = await sendMessage(deps, userCtx(b.restaurantId, b.adminId, "admin"), {
      conversationId: a.conversationId,
      body: "oi",
    }).catch((x) => x);
    expect(code(e)).toBe("not_found");
  });

  test("a failed message goes back to pending and is enqueued again (FR-019)", async () => {
    const r = await sendMessage(deps, attendant(), { conversationId: a.conversationId, body: "tentar" });
    await db`update public.messages set status = 'failed', error_code = 'ambiguous' where id = ${r.messageId}`;
    const before = await queueDepth();
    await retryMessage(deps, attendant(), { messageId: r.messageId });
    const [msg] = await db<{ status: string; error_code: string | null }[]>`
      select status, error_code from public.messages where id = ${r.messageId}`;
    expect(msg).toEqual({ status: "pending", error_code: null });
    expect(await queueDepth()).toBe(before + 1);
    const e = await retryMessage(deps, attendant(), { messageId: r.messageId }).catch((x) => x);
    expect(code(e)).toBe("conflict");
  });
});

describe("customers", () => {
  test("creates a customer with a structured address and normalized phone (FR-045, FR-047)", async () => {
    const c = await createCustomer(deps, attendant(), {
      name: "Joana Souza",
      phone: "(21) 99999-0000",
      email: "joana@example.com",
      cpfCnpj: "529.982.247-25",
      cep: "20040-020",
      logradouro: "Rua A",
      numero: "10",
      bairro: "Centro",
      cidade: "Rio de Janeiro",
      uf: "rj",
      codigoMunicipio: "3304557",
    });
    expect(c).toMatchObject({
      phone: "+5521999990000",
      cpfCnpj: "52998224725",
      cep: "20040020",
      uf: "RJ",
      ordersCount: 0,
      totalSpentCents: 0,
    });
  });

  test("a duplicate phone is rejected on the phone field (FR-047)", async () => {
    const e = await createCustomer(deps, attendant(), { name: "Outra", phone: "+5521999990000" }).catch((x) => x);
    expect(code(e)).toBe("validation_failed");
    expect(e.details?.[0]?.path).toBe("phone");
  });

  test("an invalid CPF is rejected (FR-045)", async () => {
    const e = await createCustomer(deps, attendant(), {
      name: "X",
      phone: "+5521999990001",
      cpfCnpj: "111.111.111-11",
    }).catch((x) => x);
    expect(code(e)).toBe("validation_failed");
  });

  test("the same phone can exist in another restaurant (FR-049)", async () => {
    const c = await createCustomer(deps, userCtx(b.restaurantId, b.adminId, "admin"), {
      name: "Joana B",
      phone: "+5521999990000",
    });
    expect(c.id).toBeTruthy();
  });

  test("edits only the fields given and blocks a phone taken by someone else (FR-046)", async () => {
    const list = await listCustomers(deps, attendant(), { q: "Joana" });
    const joana = list.items.find((i) => i.name === "Joana Souza")!;
    const updated = await updateCustomer(deps, attendant(), { customerId: joana.id, bairro: "Lapa", notes: "" });
    expect(updated).toMatchObject({ bairro: "Lapa", notes: null, name: "Joana Souza", cidade: "Rio de Janeiro" });
    const e = await updateCustomer(deps, attendant(), { customerId: joana.id, phone: "+5511977776666" }).catch((x) => x);
    expect(code(e)).toBe("validation_failed");
    const e2 = await updateCustomer(deps, userCtx(b.restaurantId, b.adminId, "admin"), {
      customerId: joana.id,
      name: "Hacker",
    }).catch((x) => x);
    expect(code(e2)).toBe("not_found");
  });

  test("searches by name, phone, or bairro (FR-041)", async () => {
    expect((await listCustomers(deps, attendant(), { q: "lapa" })).items.map((i) => i.name)).toContain("Joana Souza");
    expect((await listCustomers(deps, attendant(), { q: "99999-0000" })).items).toHaveLength(0);
    expect((await listCustomers(deps, attendant(), { q: "5521999990000" })).items).toHaveLength(1);
  });

  test("total orders skips cancelado; total spent counts entregue only (FR-044, ADR-015)", async () => {
    const before = await getCustomer(deps, attendant(), { customerId: a.customerId });
    expect(before.customer.ordersCount).toBe(1);
    expect(before.customer.totalSpentCents).toBe(0);
    expect(before.orders[0]).toMatchObject({ code: "ORD-001", totalCents: 4280 });
    for (const status of ["confirmado", "preparando", "pronto", "saiu", "entregue"]) {
      await db`update public.orders set status = ${status} where id = ${a.orderId}`;
    }
    const delivered = await getCustomer(deps, attendant(), { customerId: a.customerId });
    expect(delivered.customer.totalSpentCents).toBe(4280);
  });
});
