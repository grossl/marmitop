// covers FR-188, FR-125
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AppError } from "@mt/core";
import { type Db, withRestaurantContext } from "@mt/db";
import { createTestDb, type RestaurantFixture, seedRestaurant } from "@mt/db/test-harness";

import { toDbContext } from "../../context";
import type { ServiceDeps } from "../../deps";
import { createTestServiceDeps, userCtx } from "../../testing";
import { systemCtx } from "../whatsapp/connection";
import { createOrderInTx } from "./create-order";
import { setOrderPaymentMethod } from "./payment";

let db: Db;
let deps: ServiceDeps;
let a: RestaurantFixture;
let b: RestaurantFixture;

beforeAll(async () => {
  db = await createTestDb();
  deps = createTestServiceDeps(db);
  a = await seedRestaurant(db, "pay-a");
  b = await seedRestaurant(db, "pay-b");
});
afterAll(async () => db.end());

async function aiStyleOrder(r: RestaurantFixture): Promise<string> {
  return withRestaurantContext(
    db,
    toDbContext(systemCtx(r.restaurantId)),
    async (tx) => {
      const created = await createOrderInTx(tx, deps, systemCtx(r.restaurantId), {
        customerId: r.customerId,
        items: [{ menuItemId: r.menuItemId, sizeId: r.menuItemSizeId, qty: 1, notes: null }],
        fulfillment: "pickup",
        cep: null,
        logradouro: null,
        numero: null,
        complemento: null,
        bairro: null,
        cidade: null,
        uf: null,
        codigoMunicipio: null,
        paymentMethod: null,
        changeForCents: null,
        notes: null,
        source: "whatsapp",
        conversationId: r.conversationId,
      });
      return created.id;
    },
    deps.contextOptions,
  );
}

describe("null payment method", () => {
  test("createOrderInTx stores null", async () => {
    const id = await aiStyleOrder(a);
    const [o] = await db<{ payment_method: string | null; source: string }[]>`
      select payment_method, source from public.orders where id = ${id}`;
    expect(o).toEqual({ payment_method: null, source: "whatsapp" });
  });

  test("an attendant sets it", async () => {
    const id = await aiStyleOrder(a);
    const out = await setOrderPaymentMethod(deps, userCtx(a.restaurantId, a.attendantId, "attendant"), {
      orderId: id,
      paymentMethod: "pix",
    });
    expect(out).toEqual({ orderId: id, paymentMethod: "pix" });
  });

  test("another restaurant's order is not found", async () => {
    const id = await aiStyleOrder(a);
    const e = await setOrderPaymentMethod(deps, userCtx(b.restaurantId, b.adminId, "admin"), {
      orderId: id,
      paymentMethod: "pix",
    }).catch((x) => x);
    expect(e instanceof AppError ? e.code : String(e)).toBe("not_found");
  });
});
