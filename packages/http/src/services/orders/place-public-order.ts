// packages/http/src/services/orders/place-public-order.ts
//
// Orders from the public menu page /m/{public_id} (ADR-031, FR-230–237). No
// session: the restaurant comes from `mt.public_restaurant_id`, the customer
// from the phone. The order runs through `createOrderInTx` with a `system`
// context, so prices, totals, the address rule, the code, the history row,
// usage, and `order.created` match every other order (ADR-006, ADR-017).

import { createHash } from "node:crypto";

import { AppError } from "@mt/core";
import { type Tx, withoutContext, withRestaurantContext } from "@mt/db";
import { parseOrThrow, publicOrderSchema } from "@mt/schemas";
import type { z } from "zod";

import { toDbContext } from "../../context";
import type { ServiceDeps } from "../../deps";
import { isRestaurantOpen } from "../ai/menu";
import { PUBLIC_ID_PATTERN } from "../catalog/public-menu";
import { systemCtx } from "../whatsapp/connection";
import { hitRateCounter } from "../whatsapp/inbound-webhook";
import { type CreatedOrder, createOrderInTx } from "./create-order";

/** FR-235: orders a minute. */
export const PUBLIC_ORDER_LIMITS = { restaurant: 20, phone: 3 } as const;

export type PublicOrderInput = z.input<typeof publicOrderSchema>;

/** A stable uuid for one phone at one restaurant: `rate_counters.subject_id` is a uuid. */
export function phoneRateSubject(restaurantId: string, phone: string): string {
  const h = createHash("sha256").update(`${restaurantId}:${phone}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

async function resolveRestaurantId(deps: ServiceDeps, publicId: string): Promise<string> {
  if (PUBLIC_ID_PATTERN.test(publicId)) {
    const [row] = await withoutContext(
      deps.db,
      (tx) => tx<{ id: string | null }[]>`select mt.public_restaurant_id(${publicId}) as id`,
      "app_service",
    );
    if (row?.id) return row.id;
  }
  throw new AppError("not_found", "Restaurant not found.");
}

async function enforceRateLimits(deps: ServiceDeps, restaurantId: string, phone: string): Promise<void> {
  const now = deps.clock.now();
  const checks = [
    { subject: restaurantId, limit: PUBLIC_ORDER_LIMITS.restaurant },
    { subject: phoneRateSubject(restaurantId, phone), limit: PUBLIC_ORDER_LIMITS.phone },
  ];
  for (const { subject, limit } of checks) {
    const decision = await hitRateCounter(deps.db, subject, "menu_order", limit, now);
    if (!decision.allowed) {
      throw new AppError("rate_limited", "Too many orders. Try again in a minute.", {
        details: [{ path: "", code: "rate_limited", message: "Muitos pedidos seguidos. Tente de novo em um minuto." }],
      });
    }
  }
}

/** FR-233: find the customer by phone or create one. Fills empty saved values only. */
async function upsertCustomer(
  tx: Tx,
  restaurantId: string,
  input: z.output<typeof publicOrderSchema>,
): Promise<string> {
  const delivery = input.fulfillment === "delivery";
  const address = {
    logradouro: delivery ? (input.logradouro ?? null) : null,
    numero: delivery ? (input.numero ?? null) : null,
    complemento: delivery ? (input.complemento ?? null) : null,
    bairro: delivery ? (input.bairro ?? null) : null,
  };
  const [existing] = await tx<{ id: string }[]>`
    select id from public.customers where restaurant_id = ${restaurantId} and phone = ${input.phone}`;
  if (existing === undefined) {
    const [created] = await tx<{ id: string }[]>`
      insert into public.customers (restaurant_id, name, phone, logradouro, numero, complemento, bairro)
      values (${restaurantId}, ${input.name}, ${input.phone}, ${address.logradouro}, ${address.numero},
        ${address.complemento}, ${address.bairro})
      returning id`;
    if (created === undefined) throw new Error("customer insert returned no row");
    return created.id;
  }
  // A new WhatsApp customer's name is their phone (ingest-inbound.ts): that counts as empty.
  await tx`
    update public.customers set
      name = case when name = phone then ${input.name} else name end,
      logradouro = coalesce(logradouro, ${address.logradouro}::text),
      numero = coalesce(numero, ${address.numero}::text),
      complemento = coalesce(complemento, ${address.complemento}::text),
      bairro = coalesce(bairro, ${address.bairro}::text)
    where id = ${existing.id} and restaurant_id = ${restaurantId}`;
  return existing.id;
}

/**
 * Creates an order from the public menu (FR-232). Always `aguardando`, `source = menu`, no
 * conversation. Refused when the restaurant is closed (FR-234) or over the limits (FR-235).
 */
export async function placePublicOrder(
  deps: ServiceDeps,
  publicId: string,
  rawInput: PublicOrderInput,
): Promise<CreatedOrder> {
  const input = parseOrThrow(publicOrderSchema, rawInput);
  const restaurantId = await resolveRestaurantId(deps, publicId);
  await enforceRateLimits(deps, restaurantId, input.phone);

  const ctx = systemCtx(restaurantId);
  return withRestaurantContext(
    deps.db,
    toDbContext(ctx),
    async (tx) => {
      if (!(await isRestaurantOpen(tx, restaurantId, deps.clock.now()))) {
        throw new AppError("validation_failed", "The restaurant is closed.", {
          details: [{ path: "", code: "restaurant_closed", message: "O restaurante está fechado agora." }],
        });
      }
      const customerId = await upsertCustomer(tx, restaurantId, input);
      const delivery = input.fulfillment === "delivery";
      return createOrderInTx(tx, deps, ctx, {
        customerId,
        items: input.items,
        fulfillment: input.fulfillment,
        cep: null,
        // Typed parts only. A blank part falls back to the saved customer value in createOrderInTx.
        logradouro: delivery ? (input.logradouro ?? null) : null,
        numero: delivery ? (input.numero ?? null) : null,
        complemento: delivery ? (input.complemento ?? null) : null,
        bairro: delivery ? (input.bairro ?? null) : null,
        cidade: null,
        uf: null,
        codigoMunicipio: null,
        paymentMethod: input.paymentMethod,
        changeForCents: input.changeForCents,
        notes: input.notes ?? null,
        source: "menu",
        conversationId: null,
        requireConfirmation: true,
      });
    },
    deps.contextOptions,
  );
}
