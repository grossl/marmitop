// packages/db/src/orders.integration.test.ts
//
// covers FR-021, FR-022, FR-023, FR-026, FR-028, FR-037, FR-038, NFR-001, ADR-028
//
// The database backstops for orders (05.data-model.md "Order code", "Order
// status transitions", ADR-006, ADR-017): mt.next_order_code, the
// orders_status_transition trigger with its history rows, and the deferred
// orders_subtotal_matches_items check. Every probe runs on the app_service
// path, as the services will.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { canTransition } from "@mt/core";

import type { Db, RestaurantContext, Tx } from "./client";
import {
  asService,
  CHECK_VIOLATION,
  createTestDb,
  errorCode,
  type RestaurantFixture,
  seedRestaurant,
  truncateAll,
} from "./test-harness";
import type { Fulfillment, OrderStatus } from "./types";

let db: Db;
let a: RestaurantFixture;
let b: RestaurantFixture;

beforeAll(async () => {
  db = await createTestDb();
  await truncateAll(db);
  a = await seedRestaurant(db, "Pedidos A");
  b = await seedRestaurant(db, "Pedidos B");
});

afterAll(async () => {
  await db?.end({ timeout: 5 });
});

/** Creates an order with one item, the way the createOrder service will. */
async function createOrder(
  tx: Tx,
  f: RestaurantFixture,
  opts: { fulfillment?: Fulfillment; status?: OrderStatus; unit?: number; qty?: number } = {},
): Promise<{ id: string; code: string }> {
  const fulfillment = opts.fulfillment ?? "delivery";
  const unit = opts.unit ?? 1890;
  const qty = opts.qty ?? 2;
  const fee = fulfillment === "delivery" ? 500 : 0;
  const [next] = await tx<{ code: string }[]>`select mt.next_order_code(${f.restaurantId}) as code`;
  if (next === undefined) throw new Error("no order code");
  const { code } = next;
  const [order] = await tx<{ id: string }[]>`
    insert into public.orders
      (restaurant_id, code, customer_id, status, fulfillment, logradouro, bairro, payment_method,
       subtotal_cents, delivery_fee_cents, total_cents, source)
    values (${f.restaurantId}, ${code}, ${f.customerId}, ${opts.status ?? "aguardando"}, ${fulfillment},
       'Rua A', 'Centro', 'pix', ${unit * qty}, ${fee}, ${unit * qty + fee}, 'counter')
    returning id`;
  if (order === undefined) throw new Error("no order");
  await tx`
    insert into public.order_items (restaurant_id, order_id, name, unit_price_cents, qty)
    values (${f.restaurantId}, ${order.id}, 'Frango Grelhado', ${unit}, ${qty})`;
  return { id: order.id, code };
}

class Rollback extends Error {}

/** Runs `fn` on the service path and rolls the transaction back. */
async function inRollback(ctx: RestaurantContext, fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await asService(db, ctx, async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

// ---------------------------------------------------------------------------
// Order code
// ---------------------------------------------------------------------------

describe("mt.next_order_code (FR-038)", () => {
  test("codes run per restaurant, padded to three digits", async () => {
    // The fixture set each counter to 1 (ORD-001 exists).
    const codeA = await asService(db, a.attendantCtx, async (tx) => (await createOrder(tx, a)).code);
    const codeA2 = await asService(db, a.attendantCtx, async (tx) => (await createOrder(tx, a)).code);
    const codeB = await asService(db, b.attendantCtx, async (tx) => (await createOrder(tx, b)).code);
    expect([codeA, codeA2, codeB]).toEqual(["ORD-002", "ORD-003", "ORD-002"]);
  });

  test("the first order of a restaurant with no counter row is ORD-001", async () => {
    await db`delete from public.order_counters where restaurant_id = ${b.restaurantId}`;
    await inRollback(b.attendantCtx, async (tx) => {
      const [row] = await tx<{ code: string }[]>`select mt.next_order_code(${b.restaurantId}) as code`;
      expect(row?.code).toBe("ORD-001");
    });
    await db`insert into public.order_counters (restaurant_id, last_value) values (${b.restaurantId}, 2)`;
  });

  test("the width pads and never truncates: ORD-999 is followed by ORD-1000", async () => {
    await db`update public.order_counters set last_value = 998 where restaurant_id = ${b.restaurantId}`;
    const codes = await asService(db, b.attendantCtx, async (tx) => {
      const one = await tx<{ code: string }[]>`select mt.next_order_code(${b.restaurantId}) as code`;
      const two = await tx<{ code: string }[]>`select mt.next_order_code(${b.restaurantId}) as code`;
      return [one[0]?.code, two[0]?.code];
    });
    expect(codes).toEqual(["ORD-999", "ORD-1000"]);
    await db`update public.order_counters set last_value = 2 where restaurant_id = ${b.restaurantId}`;
  });

  test("concurrent orders of one restaurant get distinct, gapless codes", async () => {
    const [before] = await db<{ last_value: number }[]>`
      select last_value from public.order_counters where restaurant_id = ${a.restaurantId}`;
    const start = before?.last_value ?? 0;
    const codes = await Promise.all(
      Array.from({ length: 8 }, () => asService(db, a.attendantCtx, async (tx) => (await createOrder(tx, a)).code)),
    );
    const expected = Array.from({ length: 8 }, (_, i) => `ORD-${String(start + i + 1).padStart(3, "0")}`);
    expect([...codes].sort()).toEqual(expected);
  });

  test("a rolled-back order loses its number; the next order takes the next value", async () => {
    let lost = "";
    await inRollback(a.attendantCtx, async (tx) => {
      lost = (await createOrder(tx, a)).code;
    });
    const next = await asService(db, a.attendantCtx, async (tx) => (await createOrder(tx, a)).code);
    // The rollback also rolled back the counter update, so the number is reused.
    expect(next).toBe(lost);
  });

  test("refuses another restaurant's id and actors that cannot write orders", async () => {
    expect(
      await errorCode(() => asService(db, a.attendantCtx, (tx) => tx`select mt.next_order_code(${b.restaurantId})`)),
    ).toBe("42501");
    expect(
      await errorCode(() =>
        asService(
          db,
          { ...a.apiKeyCtx, apiKeyId: a.revokedApiKeyId },
          (tx) => tx`select mt.next_order_code(${a.restaurantId})`,
        ),
      ),
    ).toBe("42501");
  });
});

// ---------------------------------------------------------------------------
// Status transitions (ADR-017, ADR-028)
// ---------------------------------------------------------------------------

const STATUSES: OrderStatus[] = ["aguardando", "confirmado", "pronto", "saiu", "finalizado", "cancelado"];

/** 05.data-model.md "Allowed moves", transcribed. */
const ALLOWED: Record<Fulfillment, Partial<Record<OrderStatus, OrderStatus[]>>> = {
  delivery: {
    aguardando: ["confirmado", "pronto", "saiu", "finalizado", "cancelado"],
    confirmado: ["pronto", "saiu", "finalizado", "aguardando", "cancelado"],
    pronto: ["saiu", "finalizado", "confirmado", "cancelado"],
    saiu: ["finalizado", "pronto", "cancelado"],
    finalizado: [],
    cancelado: [],
  },
  pickup: {
    aguardando: ["confirmado", "pronto", "finalizado", "cancelado"],
    confirmado: ["pronto", "finalizado", "aguardando", "cancelado"],
    pronto: ["finalizado", "confirmado", "cancelado"],
    finalizado: [],
    cancelado: [],
  },
};

describe("orders_status_transition (FR-022, FR-026, ADR-017, ADR-028)", () => {
  test("mt.order_transition_allowed agrees with the ADR-017 and ADR-028 table on every triple", async () => {
    const mismatches: string[] = [];
    const rows = await db<{ f: string; s: string; t: string; ok: boolean }[]>`
      select f, s, t, mt.order_transition_allowed(s, t, f) as ok
      from unnest(${["delivery", "pickup"]}::text[]) f,
           unnest(${STATUSES}::text[]) s,
           unnest(${STATUSES}::text[]) t
      where s <> t`;
    for (const row of rows) {
      const want = (ALLOWED[row.f as Fulfillment][row.s as OrderStatus] ?? []).includes(row.t as OrderStatus);
      if (row.ok !== want) mismatches.push(`${row.f} ${row.s} -> ${row.t}: expected ${want}`);
    }
    expect(rows.length).toBe(2 * 6 * 5);
    expect(mismatches).toEqual([]);
  });

  test("packages/core canTransition agrees with the database on every (from, to, fulfillment) triple", async () => {
    const rows = await db<{ f: string; s: string; t: string; ok: boolean }[]>`
      select f, s, t, mt.order_transition_allowed(s, t, f) as ok
      from unnest(${["delivery", "pickup"]}::text[]) f,
           unnest(${STATUSES}::text[]) s,
           unnest(${STATUSES}::text[]) t`;
    const disagreements = rows
      .filter((r) => canTransition(r.s as OrderStatus, r.t as OrderStatus, r.f as Fulfillment) !== r.ok)
      .map((r) => `${r.f} ${r.s} -> ${r.t}`);
    expect(rows.length).toBe(2 * 6 * 6);
    expect(disagreements).toEqual([]);
  });

  test("every allowed move succeeds and every forbidden move is refused, through the trigger", async () => {
    const mismatches: string[] = [];
    for (const fulfillment of ["delivery", "pickup"] as const) {
      for (const from of STATUSES) {
        if (fulfillment === "pickup" && from === "saiu") continue;
        for (const to of STATUSES) {
          if (to === from) continue;
          const want = (ALLOWED[fulfillment][from] ?? []).includes(to);
          let code: string | null = null;
          await inRollback(a.attendantCtx, async (tx) => {
            const order = await createOrder(tx, a, { fulfillment, status: from });
            code = await errorCode(() =>
              tx`update public.orders set status = ${to} where id = ${order.id}`.then(() => {}),
            );
          });
          // A refused move in a pickup order may hit the saiu check first; both refuse.
          const got = code === null;
          if (got !== want) mismatches.push(`${fulfillment} ${from} -> ${to}: expected ${want}, got ${code ?? "ok"}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  test("a forward skip writes one history row with the real from and to", async () => {
    await inRollback(a.attendantCtx, async (tx) => {
      const order = await createOrder(tx, a);
      await tx`update public.orders set status = 'pronto' where id = ${order.id}`;
      const history = await tx<
        { from_status: string | null; to_status: string; changed_by: string; actor_type: string }[]
      >`
        select from_status, to_status, changed_by, actor_type from public.order_status_history
        where order_id = ${order.id} order by changed_at, from_status nulls first`;
      expect([...history]).toEqual([
        { from_status: null, to_status: "aguardando", changed_by: a.attendantId, actor_type: "user" },
        { from_status: "aguardando", to_status: "pronto", changed_by: a.attendantId, actor_type: "user" },
      ]);
    });
  });

  test("setting the same status again is a no-op with no history row", async () => {
    await inRollback(a.attendantCtx, async (tx) => {
      const order = await createOrder(tx, a, { status: "confirmado" });
      await tx`update public.orders set status = 'confirmado' where id = ${order.id}`;
      const [row] = await tx<{ n: number }[]>`
        select count(*)::int as n from public.order_status_history where order_id = ${order.id}`;
      expect(row?.n).toBe(1);
    });
  });

  test("a refused move raises check_violation and writes no history", async () => {
    await inRollback(a.attendantCtx, async (tx) => {
      const order = await createOrder(tx, a, { status: "pronto" });
      const code = await errorCode(() =>
        tx.savepoint((sp) => sp`update public.orders set status = 'aguardando' where id = ${order.id}`),
      );
      expect(code).toBe(CHECK_VIOLATION);
      const [row] = await tx<{ n: number }[]>`
        select count(*)::int as n from public.order_status_history where order_id = ${order.id}`;
      expect(row?.n).toBe(1);
    });
  });

  test("finalizado sets delivered_at and cancelado sets cancelled_at", async () => {
    await inRollback(a.attendantCtx, async (tx) => {
      const delivered = await createOrder(tx, a);
      const cancelled = await createOrder(tx, a);
      await tx`update public.orders set status = 'finalizado' where id = ${delivered.id}`;
      await tx`update public.orders set status = 'cancelado', cancel_reason = 'cliente desistiu' where id = ${cancelled.id}`;
      const rows = await tx<{ id: string; delivered_at: Date | null; cancelled_at: Date | null }[]>`
        select id, delivered_at, cancelled_at from public.orders where id in (${delivered.id}, ${cancelled.id})`;
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(delivered.id)?.delivered_at).toBeInstanceOf(Date);
      expect(byId.get(delivered.id)?.cancelled_at).toBeNull();
      expect(byId.get(cancelled.id)?.cancelled_at).toBeInstanceOf(Date);
      expect(byId.get(cancelled.id)?.delivered_at).toBeNull();
    });
  });

  test("an API key move records actor_type api_key and no user", async () => {
    await inRollback(a.apiKeyCtx, async (tx) => {
      const order = await createOrder(tx, a);
      await tx`update public.orders set status = 'confirmado' where id = ${order.id}`;
      const rows = await tx<{ changed_by: string | null; actor_type: string }[]>`
        select changed_by, actor_type from public.order_status_history
        where order_id = ${order.id} and from_status is not null`;
      expect([...rows]).toEqual([{ changed_by: null, actor_type: "api_key" }]);
    });
  });
});

// ---------------------------------------------------------------------------
// Subtotal (ADR-006)
// ---------------------------------------------------------------------------

describe("orders_subtotal_matches_items (FR-037, ADR-006)", () => {
  test("a subtotal that matches the items commits", async () => {
    const id = await asService(db, a.attendantCtx, async (tx) => (await createOrder(tx, a, { unit: 2500, qty: 3 })).id);
    const [row] = await db<{ subtotal_cents: number; total_cents: number }[]>`
      select subtotal_cents, total_cents from public.orders where id = ${id}`;
    expect(row).toEqual({ subtotal_cents: 7500, total_cents: 8000 });
  });

  test("a subtotal that does not match the items fails at commit", async () => {
    const code = await errorCode(() =>
      asService(db, a.attendantCtx, async (tx) => {
        const order = await createOrder(tx, a, { unit: 1000, qty: 1 });
        await tx`update public.orders set subtotal_cents = 900, total_cents = 1400 where id = ${order.id}`;
      }),
    );
    expect(code).toBe(CHECK_VIOLATION);
  });

  test("changing an item after the order exists must keep the subtotal in step", async () => {
    const id = await asService(db, a.attendantCtx, async (tx) => (await createOrder(tx, a, { unit: 1000, qty: 1 })).id);
    const code = await errorCode(() =>
      asService(db, a.attendantCtx, (tx) => tx`update public.order_items set qty = 2 where order_id = ${id}`),
    );
    expect(code).toBe(CHECK_VIOLATION);
    // Both sides in one transaction is fine.
    await asService(db, a.attendantCtx, async (tx) => {
      await tx`update public.order_items set qty = 2 where order_id = ${id}`;
      await tx`update public.orders set subtotal_cents = 2000, total_cents = 2500 where id = ${id}`;
    });
  });

  test("total must equal subtotal plus fee, and pickup orders carry no fee", async () => {
    for (const statement of [
      (tx: Tx, id: string) => tx`update public.orders set total_cents = total_cents + 1 where id = ${id}`,
      (tx: Tx, id: string) => tx`update public.orders set fulfillment = 'pickup' where id = ${id}`,
    ]) {
      const code = await errorCode(() =>
        asService(db, a.attendantCtx, async (tx) => {
          const order = await createOrder(tx, a);
          await statement(tx, order.id);
        }),
      );
      expect(code).toBe(CHECK_VIOLATION);
    }
  });
});
