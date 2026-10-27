// covers FR-017, FR-021, FR-030, FR-033, FR-034, FR-035, FR-036, FR-037, FR-142
import { describe, expect, test } from "bun:test";
import {
  assertDeliveryAddress,
  changeOrderStatusActionSchema,
  createOrderActionSchema,
  createOrderBodySchema,
  listOrdersQuerySchema,
  patchOrderBodySchema,
} from "./orders";

const U1 = "3f6c1a0e-7a3b-4b1e-9c53-1f3f6d0f6a11";
const U2 = "0d9e2b34-5c11-4e7a-8d2f-6a5b9c0e1f22";
const U3 = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

const apiOrder = {
  customer_id: U1,
  fulfillment: "delivery",
  cep: "01310100",
  logradouro: "Rua das Flores",
  numero: "120",
  complemento: null,
  bairro: "Centro",
  cidade: "São Paulo",
  uf: "SP",
  codigo_municipio: "3550308",
  payment_method: "pix",
  change_for_cents: null,
  notes: "Sem cebola",
  items: [{ menu_item_id: U2, size_id: U3, qty: 2, notes: null }],
};

describe("createOrderBodySchema (06.api-spec.md)", () => {
  test("accepts the documented body", () => {
    const r = createOrderBodySchema.parse(apiOrder);
    expect(r.items[0]).toMatchObject({ menu_item_id: U2, size_id: U3, qty: 2 });
    expect(r.payment_method).toBe("pix");
  });
  test("the client cannot send source, prices, totals, or status (strict)", () => {
    for (const extra of [
      { source: "whatsapp" },
      { total_cents: 1 },
      { status: "finalizado" },
      { delivery_fee_cents: 0 },
    ]) {
      expect(createOrderBodySchema.safeParse({ ...apiOrder, ...extra }).success).toBe(false);
    }
    const item = { menu_item_id: U2, qty: 1, unit_price_cents: 1 };
    expect(createOrderBodySchema.safeParse({ ...apiOrder, items: [item] }).success).toBe(false);
  });
  test("items: at least one, quantity 1..99, uuid ids", () => {
    expect(createOrderBodySchema.safeParse({ ...apiOrder, items: [] }).success).toBe(false);
    for (const qty of [0, 100, 1.5, -1]) {
      expect(createOrderBodySchema.safeParse({ ...apiOrder, items: [{ menu_item_id: U2, qty }] }).success).toBe(false);
    }
    expect(createOrderBodySchema.safeParse({ ...apiOrder, items: [{ menu_item_id: "x", qty: 1 }] }).success).toBe(
      false,
    );
  });
  test("size_id is optional (items without sizes)", () => {
    expect(createOrderBodySchema.safeParse({ ...apiOrder, items: [{ menu_item_id: U2, qty: 1 }] }).success).toBe(true);
  });
  test("item notes up to 280 characters, order notes up to 1000", () => {
    expect(
      createOrderBodySchema.safeParse({ ...apiOrder, items: [{ menu_item_id: U2, qty: 1, notes: "x".repeat(281) }] })
        .success,
    ).toBe(false);
    expect(createOrderBodySchema.safeParse({ ...apiOrder, notes: "x".repeat(1001) }).success).toBe(false);
  });
  test("address fields are optional (copied from the customer), but malformed ones fail", () => {
    const { cep, logradouro, numero, bairro, cidade, uf, codigo_municipio, complemento, ...rest } = apiOrder;
    expect(createOrderBodySchema.safeParse(rest).success).toBe(true);
    expect(createOrderBodySchema.safeParse({ ...apiOrder, cep: "123" }).success).toBe(false);
    expect(createOrderBodySchema.safeParse({ ...apiOrder, uf: "XX" }).success).toBe(false);
    expect(createOrderBodySchema.safeParse({ ...apiOrder, codigo_municipio: "1" }).success).toBe(false);
  });
  test("cep is normalized to digits", () => {
    expect(createOrderBodySchema.parse({ ...apiOrder, cep: "01310-100" }).cep).toBe("01310100");
  });
  test("payment method must be one of the four; change applies to dinheiro only (FR-035)", () => {
    expect(createOrderBodySchema.safeParse({ ...apiOrder, payment_method: "boleto" }).success).toBe(false);
    const cash = createOrderBodySchema.parse({ ...apiOrder, payment_method: "dinheiro", change_for_cents: 10000 });
    expect(cash.change_for_cents).toBe(10000);
    const pix = createOrderBodySchema.parse({ ...apiOrder, payment_method: "pix", change_for_cents: 10000 });
    expect(pix.change_for_cents).toBeNull();
  });
  test("change must be a non-negative integer", () => {
    expect(
      createOrderBodySchema.safeParse({ ...apiOrder, payment_method: "dinheiro", change_for_cents: -1 }).success,
    ).toBe(false);
    expect(
      createOrderBodySchema.safeParse({ ...apiOrder, payment_method: "dinheiro", change_for_cents: 1.5 }).success,
    ).toBe(false);
  });
  test("fulfillment is delivery or pickup", () => {
    expect(createOrderBodySchema.safeParse({ ...apiOrder, fulfillment: "drone" }).success).toBe(false);
    expect(createOrderBodySchema.safeParse({ ...apiOrder, fulfillment: "pickup" }).success).toBe(true);
  });
});

describe("assertDeliveryAddress (FR-034, after the copy from the customer)", () => {
  test("a delivery order needs logradouro and bairro: field errors for each", () => {
    const issues = assertDeliveryAddress({ fulfillment: "delivery", logradouro: null, bairro: " " });
    expect(issues.map((i) => i.path)).toEqual(["logradouro", "bairro"]);
    expect(assertDeliveryAddress({ fulfillment: "delivery", logradouro: "Rua A", bairro: "Centro" })).toEqual([]);
  });
  test("pickup needs no address", () => {
    expect(assertDeliveryAddress({ fulfillment: "pickup", logradouro: null, bairro: null })).toEqual([]);
  });
});

describe("createOrderActionSchema (dashboard Server Action, camelCase)", () => {
  const action = {
    customerId: U1,
    items: [{ menuItemId: U2, sizeId: U3, qty: 1 }],
    fulfillment: "delivery",
    cep: "01310100",
    logradouro: "Rua das Flores",
    numero: "120",
    bairro: "Centro",
    cidade: "São Paulo",
    uf: "SP",
    codigoMunicipio: "3550308",
    paymentMethod: "dinheiro",
    changeForCents: 5000,
    source: "counter",
  };
  test("accepts a counter order", () => {
    const r = createOrderActionSchema.parse(action);
    expect(r.source).toBe("counter");
    expect(r.changeForCents).toBe(5000);
  });
  test("a delivery order without logradouro or bairro gets field errors (FR-034)", () => {
    const r = createOrderActionSchema.safeParse({ ...action, logradouro: "", bairro: undefined });
    if (r.success) throw new Error("should fail");
    expect(r.error.issues.map((i) => i.path.join(".")).sort()).toEqual(["bairro", "logradouro"]);
  });
  test("pickup does not need an address", () => {
    expect(
      createOrderActionSchema.safeParse({
        customerId: U1,
        items: action.items,
        fulfillment: "pickup",
        paymentMethod: "pix",
        source: "phone",
      }).success,
    ).toBe(true);
  });
  test('source is counter, phone, or whatsapp; "api" is not allowed from the dashboard', () => {
    expect(createOrderActionSchema.safeParse({ ...action, source: "api" }).success).toBe(false);
    expect(createOrderActionSchema.safeParse({ ...action, source: "whatsapp", conversationId: U3 }).success).toBe(true);
  });
  test("change is dropped for non-cash methods", () => {
    expect(createOrderActionSchema.parse({ ...action, paymentMethod: "pix" }).changeForCents).toBeNull();
  });
});

describe("status changes (FR-021, FR-142)", () => {
  test("PATCH body takes status and an optional cancel reason", () => {
    expect(patchOrderBodySchema.parse({ status: "confirmado" })).toEqual({ status: "confirmado" });
    expect(patchOrderBodySchema.parse({ status: "cancelado", reason: "cliente desistiu" }).reason).toBe(
      "cliente desistiu",
    );
    expect(patchOrderBodySchema.safeParse({ status: "voando" }).success).toBe(false);
    expect(patchOrderBodySchema.safeParse({ status: "confirmado", total_cents: 1 }).success).toBe(false);
    expect(patchOrderBodySchema.safeParse({}).success).toBe(false);
  });
  test("Server Action input", () => {
    expect(changeOrderStatusActionSchema.safeParse({ orderId: U1, toStatus: "pronto" }).success).toBe(true);
    expect(changeOrderStatusActionSchema.safeParse({ orderId: "x", toStatus: "pronto" }).success).toBe(false);
  });
});

describe("listOrdersQuerySchema", () => {
  test("filters, coercion, and pagination", () => {
    const q = listOrdersQuerySchema.parse({
      status: "aguardando",
      source: "api",
      q: "ORD-002",
      limit: "10",
      from: "2026-10-01T00:00:00Z",
    });
    expect(q).toMatchObject({ status: "aguardando", source: "api", q: "ORD-002", limit: 10 });
    expect(listOrdersQuerySchema.safeParse({ status: "x" }).success).toBe(false);
    expect(listOrdersQuerySchema.safeParse({ from: "yesterday" }).success).toBe(false);
    expect(listOrdersQuerySchema.parse({}).limit).toBe(50);
  });
});
