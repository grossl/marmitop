// ai_carts access (12.ai-order-assistant.md "Cart lifetime"). The cart stores ids and
// quantities only, never prices (ADR-006).

import { AI_CART_ABANDON_MS, AI_SUMMARY_TTL_MS, type CartState, emptyCart } from "@mt/core";
import type { Tx } from "@mt/db";

export interface StoredCart {
  readonly id: string | null;
  readonly state: CartState;
  readonly status: "open" | "placed" | "abandoned";
  readonly summaryMessageId: string | null;
  readonly summaryVersion: number | null;
  readonly summarySentAt: Date | null;
  readonly orderId: string | null;
}

interface Row {
  id: string;
  status: "open" | "placed" | "abandoned";
  items: { menu_item_id: string; size_id: string | null; quantity: number; notes: string | null }[];
  fulfillment: "delivery" | "pickup" | null;
  customer_name: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  version: number;
  summary_message_id: string | null;
  summary_version: number | null;
  summary_sent_at: Date | null;
  order_id: string | null;
  updated_at: Date;
}

const toStored = (r: Row): StoredCart => ({
  id: r.id,
  status: r.status,
  summaryMessageId: r.summary_message_id,
  summaryVersion: r.summary_version,
  summarySentAt: r.summary_sent_at,
  orderId: r.order_id,
  state: {
    lines: r.items.map((i) => ({
      menuItemId: i.menu_item_id,
      sizeId: i.size_id,
      quantity: i.quantity,
      notes: i.notes,
    })),
    fulfillment: r.fulfillment,
    address: { logradouro: r.logradouro, numero: r.numero, bairro: r.bairro, complemento: r.complemento },
    customerName: r.customer_name,
    version: r.version,
  },
});

const NEW_CART: StoredCart = {
  id: null,
  state: emptyCart(),
  status: "open",
  summaryMessageId: null,
  summaryVersion: null,
  summarySentAt: null,
  orderId: null,
};

/**
 * The open cart; else a cart placed in the last 30 minutes (so a repeated place_order returns the
 * same order); else a new empty cart. An older placed cart never answers a later "sim".
 */
export async function loadCart(tx: Tx, restaurantId: string, conversationId: string, now: Date): Promise<StoredCart> {
  const placedSince = new Date(now.getTime() - AI_SUMMARY_TTL_MS);
  const [r] = await tx<Row[]>`
    select id, status, items, fulfillment, customer_name, logradouro, numero, complemento, bairro,
      version, summary_message_id, summary_version, summary_sent_at, order_id, updated_at
    from public.ai_carts
    where restaurant_id = ${restaurantId} and conversation_id = ${conversationId}
      and (status = 'open' or (status = 'placed' and updated_at > ${placedSince}))
    order by (status = 'open') desc, updated_at desc limit 1
    for update
  `;
  if (r === undefined) return NEW_CART;
  if (r.status === "open" && now.getTime() - r.updated_at.getTime() > AI_CART_ABANDON_MS) {
    await tx`update public.ai_carts set status = 'abandoned' where id = ${r.id} and restaurant_id = ${restaurantId}`;
    return NEW_CART;
  }
  return toStored(r);
}

/** Writes the state into the open cart, or inserts a new open cart. Returns the cart id. */
export async function saveCart(
  tx: Tx,
  restaurantId: string,
  conversationId: string,
  cart: StoredCart,
  state: CartState,
): Promise<string> {
  const items = JSON.stringify(
    state.lines.map((l) => ({ menu_item_id: l.menuItemId, size_id: l.sizeId, quantity: l.quantity, notes: l.notes })),
  );
  // `::text::jsonb`, as in packages/db/src/queue.ts: a bare jsonb cast would JSON-encode the string again.
  if (cart.id === null || cart.status !== "open") {
    const [row] = await tx<{ id: string }[]>`
      insert into public.ai_carts (restaurant_id, conversation_id, items, fulfillment, customer_name,
        logradouro, numero, complemento, bairro, version)
      values (${restaurantId}, ${conversationId}, ${items}::text::jsonb, ${state.fulfillment}, ${state.customerName},
        ${state.address.logradouro}, ${state.address.numero}, ${state.address.complemento}, ${state.address.bairro},
        ${state.version})
      returning id
    `;
    if (row === undefined) throw new Error("ai_carts insert returned no row");
    return row.id;
  }
  await tx`
    update public.ai_carts set items = ${items}::text::jsonb, fulfillment = ${state.fulfillment},
      customer_name = ${state.customerName},
      logradouro = ${state.address.logradouro}, numero = ${state.address.numero},
      complemento = ${state.address.complemento}, bairro = ${state.address.bairro}, version = ${state.version}
    where id = ${cart.id} and restaurant_id = ${restaurantId}
  `;
  return cart.id;
}
