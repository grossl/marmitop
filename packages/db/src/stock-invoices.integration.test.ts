// packages/db/src/stock-invoices.integration.test.ts
//
// covers FR-062, FR-063, FR-067, FR-124, FR-130, FR-135, NFR-001
//
// Two trigger backstops (05.data-model.md, 07.security.md "Triggers guard
// invariants that RLS cannot express"):
//   * stock_movements: the before-insert trigger applies each movement to
//     stock_items.current_qty under a row lock and writes balance_after;
//   * order_invoices_cancel_guard: only an admin (or the system worker) may
//     request a cancellation (ADR-015), and request_payload is set once
//     (ADR-016).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { Db } from "./client";
import {
  asService,
  CHECK_VIOLATION,
  createTestDb,
  errorCode,
  INSUFFICIENT_PRIVILEGE,
  type RestaurantFixture,
  seedRestaurant,
  truncateAll,
} from "./test-harness";

let db: Db;
let a: RestaurantFixture;
let b: RestaurantFixture;

beforeAll(async () => {
  db = await createTestDb();
  await truncateAll(db);
  a = await seedRestaurant(db, "Estoque A");
  b = await seedRestaurant(db, "Estoque B");
});

afterAll(async () => {
  await db?.end({ timeout: 5 });
});

async function newItem(f: RestaurantFixture): Promise<string> {
  const rows = await asService(
    db,
    f.adminCtx,
    (tx) => tx<{ id: string }[]>`
    insert into public.stock_items (restaurant_id, name, unit, category, minimum_qty, unit_cost_cents)
    values (${f.restaurantId}, 'Frango', 'kg', 'insumos', 12, 1490) returning id`,
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("no stock item");
  return id;
}

async function move(f: RestaurantFixture, itemId: string, kind: "in" | "out" | "adjust", qty: string) {
  const rows = await asService(
    db,
    f.adminCtx,
    (tx) => tx<{ balance_after: string }[]>`
    insert into public.stock_movements (restaurant_id, stock_item_id, kind, qty, balance_after, created_by)
    values (${f.restaurantId}, ${itemId}, ${kind}, ${qty}, 0, ${f.adminId}) returning balance_after`,
  );
  return rows[0]?.balance_after;
}

async function currentQty(itemId: string): Promise<string | undefined> {
  const rows = await db<{ current_qty: string }[]>`select current_qty from public.stock_items where id = ${itemId}`;
  return rows[0]?.current_qty;
}

describe("stock movements (FR-062, FR-063, FR-067)", () => {
  test("in, out and adjust update current_qty and record balance_after", async () => {
    const item = await newItem(a);
    expect(await move(a, item, "in", "24.5")).toBe("24.500");
    expect(await move(a, item, "out", "4.250")).toBe("20.250");
    expect(await move(a, item, "adjust", "-0.250")).toBe("20.000");
    expect(await move(a, item, "adjust", "3")).toBe("23.000");
    expect(await currentQty(item)).toBe("23.000");
  });

  test("an out larger than the stock is refused and changes nothing", async () => {
    const item = await newItem(a);
    await move(a, item, "in", "5");
    expect(await errorCode(() => move(a, item, "out", "5.001"))).toBe(CHECK_VIOLATION);
    expect(await currentQty(item)).toBe("5.000");
    const [row] = await db<
      { n: number }[]
    >`select count(*)::int as n from public.stock_movements where stock_item_id = ${item}`;
    expect(row?.n).toBe(1);
  });

  test("a movement cannot point at another restaurant's stock item", async () => {
    const itemB = await newItem(b);
    const code = await errorCode(() =>
      asService(
        db,
        a.adminCtx,
        (tx) => tx`
        insert into public.stock_movements (restaurant_id, stock_item_id, kind, qty, balance_after)
        values (${a.restaurantId}, ${itemB}, 'in', 100, 0)`,
      ),
    );
    expect(code).not.toBeNull();
    expect(await currentQty(itemB)).toBe("0.000");
  });

  test("concurrent movements on one item serialize on the row lock", async () => {
    const item = await newItem(a);
    await Promise.all(Array.from({ length: 10 }, () => move(a, item, "in", "1.5")));
    expect(await currentQty(item)).toBe("15.000");
    const balances = await db<{ balance_after: string }[]>`
      select balance_after from public.stock_movements where stock_item_id = ${item} order by balance_after`;
    expect(balances.map((r) => r.balance_after)).toEqual(
      Array.from({ length: 10 }, (_, i) => (1.5 * (i + 1)).toFixed(3)),
    );
  });

  test("an attendant cannot record a movement", async () => {
    const item = await newItem(a);
    const code = await errorCode(() =>
      asService(
        db,
        a.attendantCtx,
        (tx) => tx`
        insert into public.stock_movements (restaurant_id, stock_item_id, kind, qty, balance_after)
        values (${a.restaurantId}, ${item}, 'in', 1, 0)`,
      ),
    );
    expect(code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

describe("order_invoices_cancel_guard (FR-130, FR-135, ADR-015, ADR-016)", () => {
  const requestCancel =
    (invoiceId: string, userId: string | null) => (tx: Parameters<Parameters<typeof asService>[2]>[0]) =>
      tx`update public.order_invoices
         set cancel_requested_at = now(), cancel_requested_by = ${userId}, cancel_reason = 'Pedido cancelado pelo cliente'
       where id = ${invoiceId}`;

  test("an attendant cannot request a cancellation", async () => {
    const code = await errorCode(() => asService(db, a.attendantCtx, requestCancel(a.orderInvoiceId, a.attendantId)));
    expect(code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  test("an API key cannot request a cancellation", async () => {
    const code = await errorCode(() => asService(db, a.apiKeyCtx, requestCancel(a.orderInvoiceId, null)));
    expect(code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  test("an attendant cannot insert an invoice that already carries a cancellation request", async () => {
    const code = await errorCode(() =>
      asService(
        db,
        a.attendantCtx,
        (tx) => tx`
        insert into public.order_invoices (restaurant_id, order_id, kind, status, cancel_requested_at)
        values (${a.restaurantId}, ${a.orderId}, 'nfce', 'rejected', now())`,
      ),
    );
    expect(code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  test("an attendant may still update other invoice columns", async () => {
    const result = await asService(
      db,
      a.attendantCtx,
      (tx) => tx`update public.order_invoices set error_code = null where id = ${a.orderInvoiceId}`,
    );
    expect(result.count).toBe(1);
  });

  test("an admin requests a cancellation and the system worker completes it", async () => {
    const asAdmin = await asService(db, b.adminCtx, requestCancel(b.orderInvoiceId, b.adminId));
    expect(asAdmin.count).toBe(1);
    const asSystem = await asService(
      db,
      b.systemCtx,
      (tx) => tx`update public.order_invoices set status = 'cancelled' where id = ${b.orderInvoiceId}`,
    );
    expect(asSystem.count).toBe(1);
  });

  test("request_payload is set once and never changed", async () => {
    await asService(
      db,
      a.attendantCtx,
      (tx) =>
        tx`update public.order_invoices set request_payload = ${tx.json({ v: 1 })} where id = ${a.orderInvoiceId}`,
    );
    const code = await errorCode(() =>
      asService(
        db,
        a.systemCtx,
        (tx) =>
          tx`update public.order_invoices set request_payload = ${tx.json({ v: 2 })} where id = ${a.orderInvoiceId}`,
      ),
    );
    expect(code).toBe(CHECK_VIOLATION);
    // Rewriting the same body is not a change.
    const same = await asService(
      db,
      a.systemCtx,
      (tx) =>
        tx`update public.order_invoices set request_payload = ${tx.json({ v: 1 })} where id = ${a.orderInvoiceId}`,
    );
    expect(same.count).toBe(1);
  });
});
