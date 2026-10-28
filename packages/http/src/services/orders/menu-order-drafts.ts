// packages/http/src/services/orders/menu-order-drafts.ts
//
// Orders from the public menu page /m/{public_id} (ADR-031, ADR-033, FR-230–239). The page
// creates no order. `preparePublicOrder` prices the cart and saves a draft with a random
// reference; the customer sends the WhatsApp text that carries it. When that message
// arrives, `convertMenuOrderDraft` turns the draft into an order through `createOrderInTx`,
// with the sender's customer and the conversation, so prices, totals, the address rule, the
// code, the history row, usage, `order_received`, and `order.created` match every other
// order (ADR-006, ADR-017).

import { randomInt } from "node:crypto";

import {
  AppError,
  computeOrderTotal,
  formatMenuOrderMessage,
  MENU_ORDER_REFERENCE_IN_TEXT,
  weekdayInTimezone,
} from "@mt/core";
import { type Tx, withoutContext, withRestaurantContext } from "@mt/db";
import { parseOrThrow, publicOrderSchema } from "@mt/schemas";
import type { z } from "zod";

import { toDbContext } from "../../context";
import type { ServiceDeps } from "../../deps";
import { isRestaurantOpen } from "../ai/menu";
import { PUBLIC_ID_PATTERN } from "../catalog/public-menu";
import { systemCtx } from "../whatsapp/connection";
import { hitRateCounter } from "../whatsapp/inbound-webhook";
import { createOrderInTx, loadOrderMenu } from "./create-order";
import { loadOrderSettings } from "./order-settings";

/** FR-235: checkouts a minute per restaurant. */
export const PUBLIC_ORDER_LIMITS = { restaurant: 20 } as const;

/** 31 characters: `A`–`Z` and `2`–`9` without I, L, and O, which read like 1 and 0. */
const REFERENCE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export type PublicOrderInput = z.input<typeof publicOrderSchema>;
type PublicOrder = z.output<typeof publicOrderSchema>;

/** FR-238: what the checkout sends to WhatsApp. No order exists yet (ADR-033). */
export interface PreparedPublicOrder {
  readonly reference: string;
  readonly totalCents: number;
  readonly whatsappText: string;
}

/** About 40 bits: a reference cannot be guessed, unlike the sequential order code. */
export function newMenuOrderReference(): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return out;
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

async function enforceRateLimit(deps: ServiceDeps, restaurantId: string): Promise<void> {
  const decision = await hitRateCounter(
    deps.db,
    restaurantId,
    "menu_order",
    PUBLIC_ORDER_LIMITS.restaurant,
    deps.clock.now(),
  );
  if (!decision.allowed) {
    throw new AppError("rate_limited", "Too many orders. Try again in a minute.", {
      details: [{ path: "", code: "rate_limited", message: "Muitos pedidos seguidos. Tente de novo em um minuto." }],
    });
  }
}

const closedError = () =>
  new AppError("validation_failed", "The restaurant is closed.", {
    details: [{ path: "", code: "restaurant_closed", message: "O restaurante está fechado agora." }],
  });

/**
 * FR-232, FR-238: prices the cart with the order rules and saves a draft. Refused when the
 * restaurant is closed (FR-234), over the limit (FR-235), or the cart breaks an order rule.
 */
export async function preparePublicOrder(
  deps: ServiceDeps,
  publicId: string,
  rawInput: PublicOrderInput,
): Promise<PreparedPublicOrder> {
  const input = parseOrThrow(publicOrderSchema, rawInput);
  const restaurantId = await resolveRestaurantId(deps, publicId);
  await enforceRateLimit(deps, restaurantId);

  return withRestaurantContext(
    deps.db,
    toDbContext(systemCtx(restaurantId)),
    async (tx) => {
      const now = deps.clock.now();
      if (!(await isRestaurantOpen(tx, restaurantId, now))) throw closedError();
      const settings = await loadOrderSettings(tx, restaurantId);
      // The same refusals as createOrderInTx, so a draft that converts makes a valid order.
      if (input.fulfillment === "pickup" && !settings.allowPickup) {
        throw new AppError("validation_failed", "Pickup is turned off.", {
          details: [{ path: "fulfillment", code: "pickup_disabled", message: "A retirada está desativada." }],
        });
      }
      const total = computeOrderTotal({
        lines: input.items.map((i) => ({ menuItemId: i.menuItemId, sizeId: i.sizeId ?? null, qty: i.qty })),
        menu: await loadOrderMenu(
          tx,
          restaurantId,
          input.items.map((i) => i.menuItemId),
        ),
        fulfillment: input.fulfillment,
        deliveryFeeCents: settings.deliveryFeeCents,
        weekday: weekdayInTimezone(now, settings.timezone),
      });
      if (input.changeForCents !== null && input.changeForCents < total.totalCents) {
        throw new AppError("validation_failed", "Change amount is below the total.", {
          details: [
            { path: "changeForCents", code: "too_small", message: "O valor para troco deve cobrir o total do pedido." },
          ],
        });
      }

      const reference = await insertDraft(tx, restaurantId, input);
      const delivery = input.fulfillment === "delivery";
      const whatsappText = formatMenuOrderMessage({
        reference,
        customerName: input.name,
        lines: total.items.map((i) => ({
          qty: i.qty,
          name: i.name,
          sizeName: i.sizeName,
          lineTotalCents: i.lineTotalCents,
        })),
        subtotalCents: total.subtotalCents,
        deliveryFeeCents: total.deliveryFeeCents,
        totalCents: total.totalCents,
        fulfillment: input.fulfillment,
        logradouro: delivery ? (input.logradouro ?? null) : null,
        numero: delivery ? (input.numero ?? null) : null,
        complemento: delivery ? (input.complemento ?? null) : null,
        bairro: delivery ? (input.bairro ?? null) : null,
        paymentMethod: input.paymentMethod,
        changeForCents: input.changeForCents,
        notes: input.notes ?? null,
      });
      return { reference, totalCents: total.totalCents, whatsappText };
    },
    deps.contextOptions,
  );
}

/** A fresh reference; a collision with an earlier draft of this restaurant draws again. */
async function insertDraft(tx: Tx, restaurantId: string, input: PublicOrder): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const reference = newMenuOrderReference();
    const rows = await tx<{ reference: string }[]>`
      insert into public.menu_order_drafts (restaurant_id, reference, payload)
      values (${restaurantId}, ${reference}, ${tx.json(input as never)})
      on conflict (restaurant_id, reference) do nothing
      returning reference`;
    if (rows.length > 0) return reference;
  }
  throw new Error("could not draw a free menu order reference");
}

/** FR-233: fills an empty saved name (one equal to the phone) and empty address parts only. */
async function fillCustomer(tx: Tx, restaurantId: string, customerId: string, input: PublicOrder): Promise<void> {
  const delivery = input.fulfillment === "delivery";
  await tx`
    update public.customers set
      name = case when name = phone then ${input.name} else name end,
      logradouro = coalesce(logradouro, ${delivery ? (input.logradouro ?? null) : null}::text),
      numero = coalesce(numero, ${delivery ? (input.numero ?? null) : null}::text),
      complemento = coalesce(complemento, ${delivery ? (input.complemento ?? null) : null}::text),
      bairro = coalesce(bairro, ${delivery ? (input.bairro ?? null) : null}::text)
    where id = ${customerId} and restaurant_id = ${restaurantId}`;
}

export interface ConvertedMenuOrder {
  readonly id: string;
  readonly code: string;
}

/**
 * FR-239: an inbound message with `#REFERENCE` of an open, unexpired draft becomes an order,
 * while the restaurant is open. Runs in the ingest transaction under the `system` context. A
 * conversion that breaks an order rule rolls back its savepoint and returns null: the message
 * then goes the normal way.
 */
export async function convertMenuOrderDraft(
  tx: Tx,
  deps: ServiceDeps,
  restaurantId: string,
  input: { readonly body: string; readonly customerId: string; readonly conversationId: string },
): Promise<ConvertedMenuOrder | null> {
  const reference = input.body.match(MENU_ORDER_REFERENCE_IN_TEXT)?.[1];
  if (reference === undefined) return null;
  // The row lock makes the first message win; a forwarded copy finds the draft used.
  const [draft] = await tx<{ id: string; payload: unknown }[]>`
    select id, payload from public.menu_order_drafts
    where restaurant_id = ${restaurantId} and reference = ${reference}
      and order_id is null and expires_at > now()
    for update`;
  if (draft === undefined) return null;
  const parsed = publicOrderSchema.safeParse(draft.payload);
  if (!parsed.success) return null;

  if (!(await isRestaurantOpen(tx, restaurantId, deps.clock.now()))) return null;

  const order = parsed.data;
  try {
    const created = await tx.savepoint(async (sp) => {
      await fillCustomer(sp, restaurantId, input.customerId, order);
      const delivery = order.fulfillment === "delivery";
      const settings = await loadOrderSettings(sp, restaurantId);
      return createOrderInTx(sp, deps, systemCtx(restaurantId), {
        customerId: input.customerId,
        items: order.items,
        fulfillment: order.fulfillment,
        cep: null,
        // Typed parts only. A blank part falls back to the saved customer value in createOrderInTx.
        logradouro: delivery ? (order.logradouro ?? null) : null,
        numero: delivery ? (order.numero ?? null) : null,
        complemento: delivery ? (order.complemento ?? null) : null,
        bairro: delivery ? (order.bairro ?? null) : null,
        cidade: null,
        uf: null,
        codigoMunicipio: null,
        paymentMethod: order.paymentMethod,
        changeForCents: order.changeForCents,
        notes: order.notes ?? null,
        source: "menu",
        conversationId: input.conversationId,
        requireConfirmation: true,
        // FR-240, ADR-035, ADR-036: confirmed at once, with the confirmed order_received text.
        confirmOnCreate: settings.autoConfirmMenuOrders,
      });
    });
    await tx`
      update public.menu_order_drafts set order_id = ${created.id}, converted_at = now()
      where id = ${draft.id} and restaurant_id = ${restaurantId}`;
    return { id: created.id, code: created.code };
  } catch (error) {
    // An archived item, pickup turned off: a person reads the order text instead.
    if (error instanceof AppError) return null;
    throw error;
  }
}
