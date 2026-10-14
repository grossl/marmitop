// Everything apps/api needs for the public routes, as one port (04.architecture.md
// "Ports and adapters"). `createPublicApiBackend(deps)` is the production one; the
// api tests use a memory backend.

import type {
  createCustomerBodySchema,
  createOrderBodySchema,
  listCustomersQuerySchema,
  listMenuQuerySchema,
  listOrdersQuerySchema,
  patchOrderBodySchema,
  sendMessageBodySchema,
  updateCustomerBodySchema,
} from "@mt/schemas";
import type { z } from "zod";

import type { ApiKeyContext } from "../../context";
import type { ServiceDeps } from "../../deps";
import { type ApiKeyDirectory, createDbApiKeyDirectory } from "./api-keys";
import { apiCreateCustomer, apiGetCustomer, apiListCustomers, apiUpdateCustomer } from "./customers";
import type { Page } from "./cursor";
import { createDbIdempotencyStore, type IdempotencyStore } from "./idempotency";
import { apiListMenu } from "./menu";
import { apiSendMessage } from "./messages";
import { apiChangeOrderStatus, apiCreateOrder, apiGetOrder, apiListOrders } from "./orders";
import { type ApiRateLimiter, createDbApiRateLimiter } from "./rate-limit";
import type { ApiCustomer, ApiMenuItem, ApiMessage, ApiOrder, ApiOrderDetail } from "./views";

export interface PublicApiOps {
  listOrders(ctx: ApiKeyContext, query: z.input<typeof listOrdersQuerySchema>): Promise<Page<ApiOrder>>;
  getOrder(ctx: ApiKeyContext, id: string): Promise<ApiOrderDetail>;
  createOrder(ctx: ApiKeyContext, body: z.input<typeof createOrderBodySchema>): Promise<ApiOrder>;
  changeOrderStatus(ctx: ApiKeyContext, id: string, body: z.input<typeof patchOrderBodySchema>): Promise<ApiOrder>;
  listCustomers(ctx: ApiKeyContext, query: z.input<typeof listCustomersQuerySchema>): Promise<Page<ApiCustomer>>;
  getCustomer(ctx: ApiKeyContext, id: string): Promise<ApiCustomer>;
  createCustomer(ctx: ApiKeyContext, body: z.input<typeof createCustomerBodySchema>): Promise<ApiCustomer>;
  updateCustomer(ctx: ApiKeyContext, id: string, body: z.input<typeof updateCustomerBodySchema>): Promise<ApiCustomer>;
  listMenu(ctx: ApiKeyContext, query: z.input<typeof listMenuQuerySchema>): Promise<Page<ApiMenuItem>>;
  sendMessage(ctx: ApiKeyContext, body: z.input<typeof sendMessageBodySchema>): Promise<ApiMessage>;
}

export interface PublicApiBackend {
  readonly keys: ApiKeyDirectory;
  readonly rateLimiter: ApiRateLimiter;
  readonly idempotency: IdempotencyStore;
  readonly ops: PublicApiOps;
}

export function createPublicApiOps(deps: ServiceDeps): PublicApiOps {
  return {
    listOrders: (ctx, query) => apiListOrders(deps, ctx, query),
    getOrder: (ctx, id) => apiGetOrder(deps, ctx, { id }),
    createOrder: (ctx, body) => apiCreateOrder(deps, ctx, body),
    changeOrderStatus: (ctx, id, body) => apiChangeOrderStatus(deps, ctx, { ...body, id }),
    listCustomers: (ctx, query) => apiListCustomers(deps, ctx, query),
    getCustomer: (ctx, id) => apiGetCustomer(deps, ctx, { id }),
    createCustomer: (ctx, body) => apiCreateCustomer(deps, ctx, body),
    updateCustomer: (ctx, id, body) => apiUpdateCustomer(deps, ctx, { ...body, id }),
    listMenu: (ctx, query) => apiListMenu(deps, ctx, query),
    sendMessage: (ctx, body) => apiSendMessage(deps, ctx, body),
  };
}

export function createPublicApiBackend(deps: ServiceDeps): PublicApiBackend {
  return {
    keys: createDbApiKeyDirectory(deps),
    rateLimiter: createDbApiRateLimiter(deps),
    idempotency: createDbIdempotencyStore(deps),
    ops: createPublicApiOps(deps),
  };
}
