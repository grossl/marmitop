// packages/http/src/services/orders/create-order.ts
//
// Manual order creation (FR-029..FR-038; ADR-006, ADR-016, ADR-017;
// Appendix A `createOrder`). The client sends ids, sizes, and quantities. The
// server loads prices, computes the total with core, assigns the code, and
// writes the order, its item snapshots, and (by trigger) the first history row.

import {
  AppError,
  computeOrderTotal,
  type ErrorDetail,
  initialStatus,
  type MenuItemForOrder,
  type OrderStatus,
  weekdayInTimezone,
} from "@mt/core";
import { createOrderActionSchema } from "@mt/schemas";

import { defineService } from "../../service";
import { loadOrderSettings } from "./order-settings";

export interface CreatedOrder {
  readonly id: string;
  readonly code: string;
  readonly status: OrderStatus;
  readonly totalCents: number;
}

const blank = (v: string | null | undefined) => (v === undefined || v === null || v.trim() === "" ? null : v);

export const createOrder = defineService({
  name: "orders.create",
  minRole: "attendant",
  input: createOrderActionSchema,
  run: async ({ tx, ctx, deps, input }): Promise<CreatedOrder> => {
    const settings = await loadOrderSettings(tx, ctx.restaurantId);

    // FR-033: pickup only when the setting allows it.
    if (input.fulfillment === "pickup" && !settings.allowPickup) {
      throw new AppError("validation_failed", "Pickup is turned off.", {
        details: [{ path: "fulfillment", code: "pickup_disabled", message: "A retirada está desativada." }],
      });
    }

    const [customer] = await tx<
      {
        id: string;
        cep: string | null;
        logradouro: string | null;
        numero: string | null;
        complemento: string | null;
        bairro: string | null;
        cidade: string | null;
        uf: string | null;
        codigo_municipio: string | null;
      }[]
    >`
      select id, cep, logradouro, numero, complemento, bairro, cidade, uf, codigo_municipio
      from public.customers where restaurant_id = ${ctx.restaurantId} and id = ${input.customerId}
    `;
    if (customer === undefined) {
      throw new AppError("validation_failed", "Customer not found.", {
        details: [{ path: "customerId", code: "not_found", message: "Cliente não encontrado." }],
      });
    }

    if (input.conversationId) {
      const [conv] = await tx<{ id: string }[]>`
        select id from public.conversations
        where restaurant_id = ${ctx.restaurantId} and id = ${input.conversationId}`;
      if (conv === undefined) {
        throw new AppError("validation_failed", "Conversation not found.", {
          details: [{ path: "conversationId", code: "not_found", message: "Conversa não encontrada." }],
        });
      }
    }

    // FR-034 / ADR-016: omitted parts come from the customer, then the city fields from the restaurant.
    // A pickup order keeps only what the user typed.
    const delivery = input.fulfillment === "delivery";
    const address = {
      cep: blank(input.cep) ?? (delivery ? customer.cep : null),
      logradouro: blank(input.logradouro) ?? (delivery ? customer.logradouro : null),
      numero: blank(input.numero) ?? (delivery ? customer.numero : null),
      complemento: blank(input.complemento) ?? (delivery ? customer.complemento : null),
      bairro: blank(input.bairro) ?? (delivery ? customer.bairro : null),
      cidade: blank(input.cidade) ?? (delivery ? (customer.cidade ?? settings.cidade) : null),
      uf: blank(input.uf) ?? (delivery ? (customer.uf ?? settings.uf) : null),
      codigoMunicipio:
        blank(input.codigoMunicipio) ?? (delivery ? (customer.codigo_municipio ?? settings.codigoMunicipio) : null),
    };
    if (delivery) {
      const missing: ErrorDetail[] = [];
      if (!address.logradouro) missing.push({ path: "logradouro", code: "required", message: "Informe a rua." });
      if (!address.bairro) missing.push({ path: "bairro", code: "required", message: "Informe o bairro." });
      if (missing.length > 0) throw new AppError("validation_failed", "Delivery address is incomplete.", { details: missing });
    }

    // ADR-006: prices come from the database, never from the client. An archived item is not orderable.
    const itemIds = [...new Set(input.items.map((i) => i.menuItemId))];
    const menuRows = await tx<
      {
        id: string;
        kind: "meal" | "drink";
        name: string;
        price_cents: number;
        available: boolean;
        available_weekdays: number[];
      }[]
    >`
      select id, kind, name, price_cents, available, available_weekdays
      from public.menu_items
      where restaurant_id = ${ctx.restaurantId} and archived_at is null and id in ${tx(itemIds)}
    `;
    const sizeRows =
      menuRows.length === 0
        ? []
        : await tx<{ id: string; menu_item_id: string; name: string; price_cents: number }[]>`
            select id, menu_item_id, name, price_cents from public.menu_item_sizes
            where restaurant_id = ${ctx.restaurantId} and menu_item_id in ${tx(menuRows.map((m) => m.id))}
            order by position, name
          `;
    const menu: MenuItemForOrder[] = menuRows.map((m) => ({
      id: m.id,
      kind: m.kind,
      name: m.name,
      priceCents: m.price_cents,
      available: m.available,
      availableWeekdays: m.available_weekdays,
      sizes: sizeRows
        .filter((s) => s.menu_item_id === m.id)
        .map((s) => ({ id: s.id, name: s.name, priceCents: s.price_cents })),
    }));

    const total = computeOrderTotal({
      lines: input.items.map((i) => ({ menuItemId: i.menuItemId, sizeId: i.sizeId ?? null, qty: i.qty, notes: i.notes })),
      menu,
      fulfillment: input.fulfillment,
      deliveryFeeCents: settings.deliveryFeeCents,
      weekday: weekdayInTimezone(deps.clock.now(), settings.timezone),
    });

    // FR-035: the change amount must cover the total (the database checks it too).
    if (input.changeForCents !== null && input.changeForCents !== undefined && input.changeForCents < total.totalCents) {
      throw new AppError("validation_failed", "Change amount is below the total.", {
        details: [
          { path: "changeForCents", code: "too_small", message: "O valor para troco deve cobrir o total do pedido." },
        ],
      });
    }

    const status = initialStatus(settings.autoAccept);
    const [codeRow] = await tx<{ code: string }[]>`select mt.next_order_code(${ctx.restaurantId}::uuid) as code`;
    if (codeRow === undefined) throw new Error("mt.next_order_code returned no row");

    const [order] = await tx<{ id: string }[]>`
      insert into public.orders (
        restaurant_id, code, customer_id, status, fulfillment,
        cep, logradouro, numero, complemento, bairro, cidade, uf, codigo_municipio,
        payment_method, change_for_cents, notes,
        subtotal_cents, delivery_fee_cents, total_cents,
        source, conversation_id, created_by
      ) values (
        ${ctx.restaurantId}, ${codeRow.code}, ${input.customerId}, ${status}, ${input.fulfillment},
        ${address.cep}, ${address.logradouro}, ${address.numero}, ${address.complemento}, ${address.bairro},
        ${address.cidade}, ${address.uf}, ${address.codigoMunicipio},
        ${input.paymentMethod}, ${input.changeForCents ?? null}, ${input.notes ?? null},
        ${total.subtotalCents}, ${total.deliveryFeeCents}, ${total.totalCents},
        ${input.source}, ${input.conversationId ?? null}, ${ctx.actorType === "user" ? ctx.userId : null}
      )
      returning id
    `;
    if (order === undefined) throw new AppError("forbidden", "Your role cannot perform this action.");

    for (const it of total.items) {
      await tx`
        insert into public.order_items (
          restaurant_id, order_id, menu_item_id, name, size_name, unit_price_cents, qty, notes, position
        ) values (
          ${ctx.restaurantId}, ${order.id}, ${it.menuItemId}, ${it.name}, ${it.sizeName},
          ${it.unitPriceCents}, ${it.qty}, ${it.notes}, ${it.position}
        )
      `;
    }

    // P5: enqueue order_received
    // P7: order.created outbound webhook event + usage_events row (FR-039)

    return { id: order.id, code: codeRow.code, status, totalCents: total.totalCents };
  },
});
