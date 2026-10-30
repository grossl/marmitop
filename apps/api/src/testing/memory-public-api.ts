// A memory PublicApiBackend for the api route tests (tests only). It models what the
// routes rely on: keys by hash, per-key fixed-window counters, idempotency records per
// restaurant, and restaurant-scoped data whose foreign ids are 404. Domain rules (totals,
// status machine, window) are the services' job and are covered by their integration tests.

import { AppError, generateApiKey, type GeneratedApiKey } from "@mt/core";
import {
  type ApiCustomer,
  type ApiKeyContext,
  type ApiKeyRecord,
  type ApiMenuItem,
  type ApiMessage,
  type ApiOrder,
  type ApiPrintJob,
  decodeKeysetCursor,
  type IdempotencyRow,
  isStaleClaim,
  type Page,
  type PublicApiBackend,
  pageOf,
  rateLimitDecision,
} from "@mt/http";

export const RESTAURANT_A = "3f6c1a0e-7a3b-4b1e-9c53-1f3f6d0f6a11";
export const RESTAURANT_B = "0d9e2b34-5c11-4e7a-8d2f-6a5b9c0e1f22";

let seq = 0;
const uuid = () => {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
};

interface Row<T> {
  restaurantId: string;
  created_at: Date;
  id: string;
  value: T;
}

export class MemoryPublicApi {
  readonly keyA: GeneratedApiKey = generateApiKey("live");
  readonly keyB: GeneratedApiKey = generateApiKey("test");
  readonly revokedKey: GeneratedApiKey = generateApiKey("live");
  readonly calls: string[] = [];
  readonly touched: string[] = [];
  readonly orders: Row<ApiOrder>[] = [];
  readonly customers: Row<ApiCustomer>[] = [];
  readonly menu: Row<ApiMenuItem>[] = [];
  readonly printJobs: Row<ApiPrintJob>[] = [];
  /** Customer ids whose 24-hour window is open. */
  readonly windowOpen = new Set<string>();
  private readonly keys = new Map<string, ApiKeyRecord>();
  private readonly counters = new Map<string, number>();
  private readonly idem = new Map<string, IdempotencyRow & { createdAt: Date }>();
  private clock = new Date("2026-10-13T12:00:00Z").getTime();

  constructor() {
    this.keys.set(this.keyA.hash, { id: uuid(), restaurantId: RESTAURANT_A, environment: "live", revokedAt: null });
    this.keys.set(this.keyB.hash, { id: uuid(), restaurantId: RESTAURANT_B, environment: "test", revokedAt: null });
    this.keys.set(this.revokedKey.hash, {
      id: uuid(),
      restaurantId: RESTAURANT_A,
      environment: "live",
      revokedAt: new Date(),
    });
  }

  private tick(): Date {
    this.clock += 1000;
    return new Date(this.clock);
  }

  addCustomer(restaurantId: string, over: Partial<ApiCustomer> = {}): ApiCustomer {
    const created = this.tick();
    const value: ApiCustomer = {
      id: uuid(),
      name: "Joana",
      phone: `+55119999${String(seq).padStart(5, "0")}`,
      email: null,
      cpf_cnpj: null,
      cep: null,
      logradouro: "Rua A",
      numero: "1",
      complemento: null,
      bairro: "Centro",
      cidade: "São Paulo",
      uf: "SP",
      codigo_municipio: "3550308",
      notes: null,
      orders_count: 0,
      total_spent_cents: 0,
      created_at: created.toISOString(),
      ...over,
    };
    this.customers.push({ restaurantId, created_at: created, id: value.id, value });
    return value;
  }

  /** An in-progress claim, as a request that is running (or died) would leave it. */
  seedClaim(restaurantId: string, key: string, requestHash: string, createdAt: Date): void {
    this.idem.set(`${restaurantId}:${key}`, {
      status: "in_progress",
      requestHash,
      responseStatus: null,
      responseBody: null,
      createdAt,
    });
  }

  addMenuItem(restaurantId: string, over: Partial<ApiMenuItem> = {}): ApiMenuItem {
    const created = this.tick();
    const value: ApiMenuItem = {
      id: uuid(),
      kind: "meal",
      name: "Frango",
      description: null,
      category: "proteinas",
      price_cents: 1890,
      calories: null,
      volume: null,
      available: true,
      popular: false,
      available_weekdays: [0, 1, 2, 3, 4, 5, 6],
      image_url: null,
      sizes: [],
      ...over,
    };
    this.menu.push({ restaurantId, created_at: created, id: value.id, value });
    return value;
  }

  private list<T>(
    rows: Row<T>[],
    ctx: ApiKeyContext,
    cursor: string | undefined,
    limit: number,
    keep = (_v: T) => true,
  ): Page<T> {
    const after = decodeKeysetCursor(cursor);
    const mine = rows
      .filter((r) => r.restaurantId === ctx.restaurantId && keep(r.value))
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || (a.id < b.id ? 1 : -1))
      .filter(
        (r) =>
          after === null ||
          r.created_at.getTime() < after.createdAt.getTime() ||
          (r.created_at.getTime() === after.createdAt.getTime() && r.id < after.id),
      );
    return pageOf(mine.slice(0, limit + 1), limit, (r) => r.value);
  }

  private find<T>(rows: Row<T>[], ctx: ApiKeyContext, idOrCode: string, what: string): Row<T> {
    const row = rows.find(
      (r) =>
        r.restaurantId === ctx.restaurantId && (r.id === idOrCode || (r.value as { code?: string }).code === idOrCode),
    );
    if (row === undefined) throw new AppError("not_found", `${what} not found.`);
    return row;
  }

  backend(): PublicApiBackend {
    const self = this;
    return {
      keys: {
        lookup: async (hash) => self.keys.get(hash) ?? null,
        touch: async (ctx) => {
          self.touched.push(ctx.apiKeyId);
        },
      },
      rateLimiter: {
        hit: async (apiKeyId, cls, now) => {
          const key = `${apiKeyId}:${cls}:${Math.floor(now.getTime() / 60_000)}`;
          const count = (self.counters.get(key) ?? 0) + 1;
          self.counters.set(key, count);
          return rateLimitDecision(count, cls === "read" ? 600 : 120, now);
        },
      },
      idempotency: {
        claim: async (ctx, key, requestHash) => {
          const id = `${ctx.restaurantId}:${key}`;
          const row = self.idem.get(id);
          if (row === undefined || (row.status === "in_progress" && isStaleClaim(row.createdAt, new Date()))) {
            self.idem.set(id, {
              status: "in_progress",
              requestHash,
              responseStatus: null,
              responseBody: null,
              createdAt: new Date(),
            });
            return { kind: "claimed" };
          }
          return { kind: "existing", row };
        },
        complete: async (ctx, key, response) => {
          const id = `${ctx.restaurantId}:${key}`;
          const row = self.idem.get(id);
          if (row?.status === "in_progress") {
            self.idem.set(id, {
              ...row,
              status: "completed",
              responseStatus: response.status,
              responseBody: response.body,
            });
          }
        },
        release: async (ctx, key) => {
          const id = `${ctx.restaurantId}:${key}`;
          if (self.idem.get(id)?.status === "in_progress") self.idem.delete(id);
        },
      },
      ops: {
        async listOrders(ctx, q) {
          self.calls.push("listOrders");
          return self.list(
            self.orders,
            ctx,
            q.cursor,
            Number(q.limit ?? 50),
            (o) => !q.status || o.status === q.status,
          );
        },
        async getOrder(ctx, id) {
          self.calls.push("getOrder");
          return { ...self.find(self.orders, ctx, id, "Order").value, status_history: [] };
        },
        async createOrder(ctx, body) {
          self.calls.push("createOrder");
          const customer = self.customers.find((c) => c.restaurantId === ctx.restaurantId && c.id === body.customer_id);
          if (customer === undefined) {
            throw new AppError("validation_failed", "Customer not found.", {
              details: [{ path: "customerId", code: "not_found", message: "Cliente não encontrado." }],
            });
          }
          const created = self.tick();
          const order: ApiOrder = {
            id: uuid(),
            code: `ORD-${String(self.orders.length + 1).padStart(3, "0")}`,
            status: "aguardando",
            customer_id: customer.id,
            fulfillment: body.fulfillment,
            cep: null,
            logradouro: customer.value.logradouro,
            numero: customer.value.numero,
            complemento: null,
            bairro: customer.value.bairro,
            cidade: customer.value.cidade,
            uf: customer.value.uf,
            codigo_municipio: customer.value.codigo_municipio,
            payment_method: body.payment_method,
            change_for_cents: null,
            notes: typeof body.notes === "string" ? body.notes : null,
            subtotal_cents: 1890 * body.items.length,
            delivery_fee_cents: 0,
            total_cents: 1890 * body.items.length,
            source: "api",
            conversation_id: null,
            items: [],
            created_at: created.toISOString(),
            delivered_at: null,
          };
          self.orders.push({ restaurantId: ctx.restaurantId, created_at: created, id: order.id, value: order });
          return order;
        },
        async changeOrderStatus(ctx, id, body) {
          self.calls.push("changeOrderStatus");
          const row = self.find(self.orders, ctx, id, "Order");
          if (row.value.status === "finalizado" || row.value.status === "cancelado") {
            throw new AppError("invalid_status_transition", "Final status.", {
              details: [{ path: "status", code: "invalid_status_transition", message: "Allowed: nenhum." }],
            });
          }
          row.value = { ...row.value, status: body.status };
          return row.value;
        },
        async listCustomers(ctx, q) {
          self.calls.push("listCustomers");
          return self.list(self.customers, ctx, q.cursor, Number(q.limit ?? 50));
        },
        async getCustomer(ctx, id) {
          self.calls.push("getCustomer");
          return self.find(self.customers, ctx, id, "Customer").value;
        },
        async createCustomer(ctx, body) {
          self.calls.push("createCustomer");
          if (self.customers.some((c) => c.restaurantId === ctx.restaurantId && c.value.phone === body.phone)) {
            throw new AppError("conflict", "A customer with this phone already exists.", {
              details: [{ path: "phone", code: "duplicate_phone", message: "Já existe um cliente com este telefone." }],
            });
          }
          return self.addCustomer(ctx.restaurantId, { name: body.name, phone: body.phone });
        },
        async updateCustomer(ctx, id, body) {
          self.calls.push("updateCustomer");
          const row = self.find(self.customers, ctx, id, "Customer");
          row.value = { ...row.value, ...(body as Partial<ApiCustomer>) };
          return row.value;
        },
        async listMenu(ctx, q) {
          self.calls.push("listMenu");
          return self.list(self.menu, ctx, q.cursor, Number(q.limit ?? 50), (m) => !q.kind || m.kind === q.kind);
        },
        async sendMessage(ctx, body) {
          self.calls.push("sendMessage");
          const customer = self.find(self.customers, ctx, body.customer_id, "Customer");
          if (!self.windowOpen.has(customer.id)) {
            throw new AppError("outside_service_window", "The customer last wrote more than 24 hours ago.");
          }
          const message: ApiMessage = {
            id: uuid(),
            conversation_id: uuid(),
            customer_id: customer.id,
            direction: "out",
            body: body.body,
            status: "pending",
            order_id: body.order_id ?? null,
            created_at: self.tick().toISOString(),
          };
          return message;
        },
        async claimPrintJobs(ctx, body) {
          self.calls.push("claimPrintJobs");
          const picked = self.printJobs
            .filter((j) => j.restaurantId === ctx.restaurantId && j.value.status === "pending")
            .slice(0, body.limit ?? 5);
          for (const j of picked) j.value = { ...j.value, status: "printing", attempts: j.value.attempts + 1 };
          return { data: picked.map((j) => j.value) };
        },
        async reportPrintJobResult(ctx, id, body) {
          self.calls.push("reportPrintJobResult");
          const row = self.find(self.printJobs, ctx, id, "Print job");
          if (row.value.status !== "printing") throw new AppError("conflict", "The print job is not being printed.");
          row.value = { ...row.value, status: body.printed ? "printed" : "pending", last_error: body.error ?? null };
          return row.value;
        },
      },
    };
  }
}
