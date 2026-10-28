// The assistant's tools (12.ai-order-assistant.md "Tools", FR-184..FR-190, FR-195). The scope binds
// the tenant: no tool input names a restaurant, customer, or conversation. Every input is parsed with
// its Zod schema first. Errors return as results, never as throws, so the model can recover.

import {
  type AiPauseReason,
  AppError,
  applyCartPatch,
  checkPlaceOrder,
  formatBRL,
  missingCartFields,
  quoteCart,
  renderOrderSummary,
} from "@mt/core";
import type { Tx } from "@mt/db";
import { emptyToolInputSchema, handoffInputSchema, searchMenuInputSchema, updateCartInputSchema } from "@mt/schemas";
import type { ZodIssue, ZodTypeAny, z } from "zod";

import type { ServiceDeps } from "../../deps";
import { createOrderInTx } from "../orders/create-order";
import { loadOrderSettings } from "../orders/order-settings";
import { systemCtx } from "../whatsapp/connection";
import { loadCart, saveCart } from "./cart-store";
import { isRestaurantOpen, loadTodayMenu } from "./menu";
import { pauseConversation, storeAiMessage } from "./messages";
import { loadAiSettings } from "./settings";

export interface AiToolScope {
  readonly restaurantId: string;
  readonly conversationId: string;
  readonly customerId: string;
  readonly runId: string;
}

export interface AiToolResult {
  readonly ok: boolean;
  readonly content: string;
  readonly errorCode: string | null;
  /** The customer already got this turn's answer from the system (FR-210, FR-212): the turn sends no text. */
  readonly silencesReply?: boolean;
}

type Parsed<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly result: AiToolResult };

const ok = (value: unknown): AiToolResult => ({ ok: true, content: JSON.stringify(value), errorCode: null });
const fail = (code: string, message: string): AiToolResult => ({
  ok: false,
  content: JSON.stringify({ error: code, message }),
  errorCode: code,
});

const MAX_ISSUES = 3;

/**
 * One line per Zod issue: the field path and why it failed. The JSON Schemas the model sees carry
 * no limits (strict tool use), so this is how it learns them. Never echoes the rejected value.
 */
function describeIssue(issue: ZodIssue): string {
  const path = issue.path.length === 0 ? "(input)" : issue.path.join(".");
  switch (issue.code) {
    case "invalid_enum_value":
      // Zod's own message quotes the received value.
      return `${path}: Expected one of ${issue.options.join(" | ")}`;
    case "invalid_type":
      return `${path}: Expected ${issue.expected}, received ${issue.received}`;
    default:
      return `${path}: ${issue.message}`;
  }
}

function parse<S extends ZodTypeAny>(schema: S, raw: unknown): Parsed<z.output<S>> {
  const r = schema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  const issues = r.error.issues.slice(0, MAX_ISSUES).map(describeIssue).join("; ");
  return { ok: false, result: fail("invalid_input", `Input does not match the schema: ${issues}.`) };
}

/** The first field-error code of an AppError (`item_unavailable`, `pickup_disabled`, …), or its code. */
function codeOf(e: AppError): string {
  return e.details?.[0]?.code ?? e.code;
}

async function searchMenu(tx: Tx, deps: ServiceDeps, scope: AiToolScope, raw: unknown): Promise<AiToolResult> {
  const input = parse(searchMenuInputSchema, raw);
  if (!input.ok) return input.result;
  const { menu, categories } = await loadTodayMenu(tx, deps, scope.restaurantId);
  const q = input.data.query ? input.data.query.toLocaleLowerCase("pt-BR") : null;
  const items = menu
    .filter((m) => q === null || m.name.toLocaleLowerCase("pt-BR").includes(q))
    .slice(0, 40)
    .map((m) => ({
      menu_item_id: m.id,
      name: m.name,
      kind: m.kind,
      category: categories.get(m.id) ?? null,
      price: m.sizes.length === 0 ? formatBRL(m.priceCents) : null,
      sizes: m.sizes.map((s) => ({ size_id: s.id, name: s.name, price: formatBRL(s.priceCents) })),
    }));
  return ok({ items });
}

async function updateCart(tx: Tx, deps: ServiceDeps, scope: AiToolScope, raw: unknown): Promise<AiToolResult> {
  const parsed = parse(updateCartInputSchema, raw);
  if (!parsed.ok) return parsed.result;
  const input = parsed.data;
  const settings = await loadOrderSettings(tx, scope.restaurantId);
  if (input.fulfillment === "pickup" && !settings.allowPickup) return fail("pickup_disabled", "Pickup is turned off.");

  const cart = await loadCart(tx, scope.restaurantId, scope.conversationId);
  // A cart placed in the last 30 minutes keeps its fulfillment and address; its items start over.
  const base = cart.status === "open" ? cart.state : { ...cart.state, lines: [], version: 1 };
  const next = applyCartPatch(base, {
    lines:
      input.items?.map((i) => ({
        menuItemId: i.menu_item_id,
        sizeId: i.size_id,
        quantity: i.quantity,
        notes: i.notes,
      })) ?? null,
    fulfillment: input.fulfillment,
    address: input.address,
    customerName: input.customer_name,
  });
  const { menu, weekday } = await loadTodayMenu(tx, deps, scope.restaurantId);
  let total: ReturnType<typeof quoteCart>;
  try {
    total = quoteCart({ cart: next, menu, deliveryFeeCents: settings.deliveryFeeCents, weekday });
  } catch (e) {
    if (e instanceof AppError) return fail(codeOf(e), "An item is not on today's menu or needs a valid size.");
    throw e;
  }
  await saveCart(tx, scope.restaurantId, scope.conversationId, cart, next);
  // FR-216: an empty saved name (it equals the phone) takes the name at once; a saved name stays.
  if (input.customer_name !== null && input.customer_name.trim() !== "") {
    await tx`
      update public.customers set name = ${input.customer_name.trim()}
      where id = ${scope.customerId} and restaurant_id = ${scope.restaurantId} and name = phone`;
  }
  const delivery = next.fulfillment === "delivery";
  return ok({
    items: total.items.map((i) => ({
      name: i.name,
      size: i.sizeName,
      quantity: i.qty,
      line_total: formatBRL(i.lineTotalCents),
      notes: i.notes,
    })),
    fulfillment: next.fulfillment,
    address: next.address,
    subtotal: formatBRL(total.subtotalCents),
    delivery_fee: delivery ? formatBRL(settings.deliveryFeeCents) : null,
    total: formatBRL(delivery ? total.subtotalCents + settings.deliveryFeeCents : total.subtotalCents),
    missing: missingCartFields(next),
  });
}

async function sendOrderSummary(tx: Tx, deps: ServiceDeps, scope: AiToolScope, raw: unknown): Promise<AiToolResult> {
  const parsed = parse(emptyToolInputSchema, raw);
  if (!parsed.ok) return parsed.result;
  const now = deps.clock.now();
  const cart = await loadCart(tx, scope.restaurantId, scope.conversationId);
  const fulfillment = cart.state.fulfillment;
  if (cart.id === null || cart.status !== "open" || missingCartFields(cart.state).length > 0 || fulfillment === null) {
    return fail("cart_incomplete", "Fill every missing field first.");
  }
  const settings = await loadOrderSettings(tx, scope.restaurantId);
  const { menu, weekday } = await loadTodayMenu(tx, deps, scope.restaurantId);
  let total: ReturnType<typeof quoteCart>;
  try {
    total = quoteCart({ cart: cart.state, menu, deliveryFeeCents: settings.deliveryFeeCents, weekday });
  } catch (e) {
    if (e instanceof AppError) return fail(codeOf(e), "An item is no longer on today's menu.");
    throw e;
  }
  const body = renderOrderSummary({ total, fulfillment, address: cart.state.address });
  const messageId = await storeAiMessage(tx, scope.restaurantId, {
    conversationId: scope.conversationId,
    body,
    aiRunId: scope.runId,
    at: now,
  });
  await tx`
    update public.ai_carts set summary_message_id = ${messageId}, summary_version = version, summary_sent_at = ${now}
    where id = ${cart.id} and restaurant_id = ${scope.restaurantId}
  `;
  return {
    ...ok({
      sent: true,
      note: "The customer received the summary. It already asks whether you can confirm the order. End your turn with no text.",
    }),
    silencesReply: true,
  };
}

async function placeOrder(tx: Tx, deps: ServiceDeps, scope: AiToolScope, raw: unknown): Promise<AiToolResult> {
  const parsed = parse(emptyToolInputSchema, raw);
  if (!parsed.ok) return parsed.result;
  const now = deps.clock.now();
  const cart = await loadCart(tx, scope.restaurantId, scope.conversationId);

  // Idempotent: a cart placed in the last 30 minutes answers with its order.
  if (cart.status === "placed" && cart.orderId !== null) {
    const [o] = await tx<{ code: string; status: string; total_cents: number }[]>`
      select code, status, total_cents from public.orders
      where id = ${cart.orderId} and restaurant_id = ${scope.restaurantId}`;
    if (o !== undefined) {
      const notified = await customerNotified(tx, scope.restaurantId, cart.orderId);
      return {
        ...ok({ code: o.code, status: o.status, total: formatBRL(o.total_cents), customer_notified: notified }),
        silencesReply: notified,
      };
    }
  }
  const fulfillment = cart.state.fulfillment;
  if (cart.id === null || fulfillment === null) {
    return fail("not_confirmed", "Send the summary and wait for the customer.");
  }

  const [after] = await tx<{ n: number }[]>`
    select count(*)::int as n from public.messages m
    join public.messages s on s.id = ${cart.summaryMessageId} and s.restaurant_id = m.restaurant_id
    where m.restaurant_id = ${scope.restaurantId} and m.conversation_id = ${scope.conversationId}
      and m.direction = 'in' and m.created_at > s.created_at
  `;
  const guard = checkPlaceOrder({
    status: cart.status,
    version: cart.state.version,
    summaryVersion: cart.summaryVersion,
    summarySentAt: cart.summarySentAt,
    inboundAfterSummary: (after?.n ?? 0) > 0,
    open: await isRestaurantOpen(tx, scope.restaurantId, now),
    now,
  });
  if (!guard.ok) {
    return fail(
      guard.code,
      guard.code === "closed" ? "The restaurant is closed now." : "The customer has not confirmed the latest summary.",
    );
  }

  const delivery = fulfillment === "delivery";
  const address = cart.state.address;
  // FR-187: fill an empty saved name before the order, so the order_received message that
  // createOrderInTx writes greets the customer by name. A new customer's name is their phone
  // (ingest-inbound.ts). A saved name is never replaced.
  const name = cart.state.customerName;
  if (name !== null) {
    await tx`
      update public.customers set name = ${name}
      where id = ${scope.customerId} and restaurant_id = ${scope.restaurantId} and name = phone`;
  }

  let created: Awaited<ReturnType<typeof createOrderInTx>>;
  try {
    created = await createOrderInTx(tx, deps, systemCtx(scope.restaurantId), {
      customerId: scope.customerId,
      items: cart.state.lines.map((l) => ({
        menuItemId: l.menuItemId,
        sizeId: l.sizeId,
        qty: l.quantity,
        notes: l.notes,
      })),
      fulfillment,
      cep: null,
      logradouro: delivery ? address.logradouro : null,
      numero: delivery ? address.numero : null,
      complemento: delivery ? address.complemento : null,
      bairro: delivery ? address.bairro : null,
      cidade: null,
      uf: null,
      codigoMunicipio: null,
      paymentMethod: null,
      changeForCents: null,
      notes: null,
      source: "whatsapp",
      conversationId: scope.conversationId,
      requireConfirmation: true,
      // FR-213, ADR-036: auto-confirm is a real status move, so order_confirmed goes out (FR-201).
      confirmOnCreate: (await loadAiSettings(tx, scope.restaurantId)).autoConfirmOrders,
    });
  } catch (e) {
    if (e instanceof AppError) return fail(codeOf(e), "The order was refused. Check the items and the address.");
    throw e;
  }

  await tx`update public.orders set ai_run_id = ${scope.runId} where id = ${created.id} and restaurant_id = ${scope.restaurantId}`;
  await tx`
    update public.ai_carts set status = 'placed', order_id = ${created.id}
    where id = ${cart.id} and restaurant_id = ${scope.restaurantId}`;
  // FR-187: fill empty saved address fields from a delivery cart; a saved value is never replaced.
  if (delivery) {
    await tx`
      update public.customers set
        logradouro = coalesce(logradouro, ${address.logradouro}::text),
        numero = coalesce(numero, ${address.numero}::text),
        complemento = coalesce(complemento, ${address.complemento}::text),
        bairro = coalesce(bairro, ${address.bairro}::text)
      where id = ${scope.customerId} and restaurant_id = ${scope.restaurantId}
    `;
  }
  const status = created.status;
  const notified = await customerNotified(tx, scope.restaurantId, created.id);
  const settings = await loadOrderSettings(tx, scope.restaurantId);
  return {
    ...ok({
      code: created.code,
      status,
      total: formatBRL(created.totalCents),
      delivery_estimate_minutes: settings.showDeliveryEstimate ? settings.deliveryEstimateMinutes : null,
      customer_notified: notified,
    }),
    silencesReply: notified,
  };
}

/** FR-212: an automatic message for the order (order_received, order_confirmed) is queued, not failed. */
async function customerNotified(tx: Tx, restaurantId: string, orderId: string): Promise<boolean> {
  const [r] = await tx<{ n: number }[]>`
    select count(*)::int as n from public.messages
    where restaurant_id = ${restaurantId} and order_id = ${orderId}
      and automatic_kind is not null and status <> 'failed'`;
  return (r?.n ?? 0) > 0;
}

async function handoff(tx: Tx, deps: ServiceDeps, scope: AiToolScope, raw: unknown): Promise<AiToolResult> {
  const parsed = parse(handoffInputSchema, raw);
  if (!parsed.ok) return parsed.result;
  const reason: AiPauseReason = parsed.data.reason;
  await pauseConversation(
    tx,
    scope.restaurantId,
    scope.conversationId,
    reason,
    parsed.data.note || null,
    deps.clock.now(),
  );
  return ok({ paused: true });
}

type Handler = (tx: Tx, deps: ServiceDeps, scope: AiToolScope, raw: unknown) => Promise<AiToolResult>;

const HANDLERS: ReadonlyMap<string, Handler> = new Map<string, Handler>([
  ["search_menu", searchMenu],
  ["update_cart", updateCart],
  ["send_order_summary", sendOrderSummary],
  ["place_order", placeOrder],
  ["handoff_to_human", handoff],
]);

/** Runs one model tool call inside the caller's transaction. Unknown names and bad input return as results. */
export async function runAiTool(
  tx: Tx,
  deps: ServiceDeps,
  scope: AiToolScope,
  name: string,
  raw: unknown,
): Promise<AiToolResult> {
  const handler = HANDLERS.get(name);
  if (handler === undefined) return fail("unknown_tool", "No tool by that name.");
  return handler(tx, deps, scope, raw);
}
