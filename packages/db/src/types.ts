// packages/db/src/types.ts
//
// Row types for every table in supabase/migrations, written by hand to match
// the SQL (05.data-model.md). When a migration changes a column, this file
// changes in the same commit.
//
// Mapping rules (see createDb in ./client):
//   uuid, text, time   -> string
//   timestamptz        -> Date
//   integer, smallint  -> number
//   bigint (int8)      -> number   (money in cents, ADR-006; safe-integer checked)
//   numeric(12,3)      -> string   (stock quantities; exact decimal text)
//   jsonb              -> Json
//   bytea              -> Uint8Array
//   smallint[], text[] -> number[], string[]
//   nullable column    -> `| null`

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

// ---------------------------------------------------------------------------
// Enumerations: lowercase text with check constraints.
// ---------------------------------------------------------------------------

export type MemberRole = "admin" | "attendant";
export type ActorRole = MemberRole;
export type AutomaticMessageKind =
  | "welcome"
  | "closed"
  | "order_received"
  // ADR-026, migration 0021
  | "order_confirmed"
  | "order_preparing"
  | "order_ready"
  | "order_out_for_delivery"
  | "order_delivered"
  | "order_cancelled";
export type SecretKind =
  | "uatis_api_key"
  | "uatis_webhook_secret"
  | "webnf_api_key"
  | "webnf_webhook_secret"
  | "outbound_webhook_secret";
export type IntegrationStatus = "disconnected" | "connected" | "error";
export type FiscalEnvironment = "homologacao" | "producao";
export type DeliveryFeeMode = "item" | "none";
export type MessageDirection = "in" | "out";
export type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";
export type MenuItemKind = "meal" | "drink";
export type MealCategory = "proteinas" | "vegetariano" | "fit" | "executiva" | "especial";
export type DrinkCategory = "refrigerantes" | "sucos" | "agua" | "alcoolicas" | "quentes";
export type MenuCategory = MealCategory | DrinkCategory;
export type OrderStatus = "aguardando" | "confirmado" | "preparando" | "pronto" | "saiu" | "entregue" | "cancelado";
export type Fulfillment = "delivery" | "pickup";
export type PaymentMethod = "pix" | "dinheiro" | "cartao_credito" | "cartao_debito";
export type OrderSource = "counter" | "phone" | "whatsapp" | "api";
export type StatusActorType = "user" | "api_key" | "system";
export type InvoiceKind = "nfce" | "nfe";
export type InvoiceStatus =
  | "queued"
  | "received"
  | "processing"
  | "authorized"
  | "rejected"
  | "denied"
  | "failed"
  | "cancelled";
export type StockCategory = "insumos" | "embalagens" | "bebidas";
export type StockMovementKind = "in" | "out" | "adjust";
export type ApiKeyEnvironment = "live" | "test";
export type WebhookEvent = "order.created" | "order.status_changed" | "message.received" | "invoice.updated";
export type WebhookDeliveryStatus = "pending" | "delivered" | "failed" | "exhausted";
export type JobQueue = "mt_outbound_messages" | "mt_webhook_deliveries" | "mt_invoice_jobs" | "mt_sync" | "mt_ai_turns";
export type JobSubjectType = "message" | "webhook_delivery" | "order_invoice" | "sync" | "ai_turn";
export type JobOutcome = "ok" | "transient_error" | "permanent_error";
export type UsageEventKind = "order.created" | "message.sent" | "invoice.issued" | "ai.reply";
export type RateClass = "read" | "write" | "webhook";
export type AiMode = "auto" | "paused";
export type AiPauseReason =
  | "attendant"
  | "manual"
  | "customer_request"
  | "complaint"
  | "order_change"
  | "status_question"
  | "unsupported_media"
  | "unclear"
  | "other"
  | "model"
  | "stale"
  | "quota"
  | "cap";

/** Weekday 0–6, 0 = Sunday, as `extract(dow from ...)`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

export interface PlanRow {
  code: string;
  name: string;
  included_orders_month: number;
  included_messages_month: number;
  included_invoices_month: number;
  price_display: string;
  /** AI replies included each month (FR-194, migration 0020). */
  included_ai_replies_month: number;
  /** Overage price per 100 AI replies, in cents (FR-194). */
  ai_overage_price_cents: number;
}

// ---------------------------------------------------------------------------
// Tenancy and settings
// ---------------------------------------------------------------------------

export interface RestaurantRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  cidade: string | null;
  uf: string | null;
  codigo_municipio: string | null;
  plan_code: string;
  created_at: Date;
  updated_at: Date;
}

export interface RestaurantMemberRow {
  id: string;
  restaurant_id: string;
  user_id: string;
  role: MemberRole;
  created_at: Date;
}

export interface RestaurantSettingsRow {
  restaurant_id: string;
  auto_accept: boolean;
  allow_pickup: boolean;
  show_delivery_estimate: boolean;
  delivery_estimate_minutes: number;
  delivery_fee_cents: number;
  timezone: string;
  updated_at: Date;
}

export interface BusinessHoursRow {
  id: string;
  restaurant_id: string;
  weekday: Weekday;
  enabled: boolean;
  /** `HH:MM:SS`, local time in restaurant_settings.timezone. */
  opens_at: string;
  closes_at: string;
}

export interface AutomaticMessageRow {
  id: string;
  restaurant_id: string;
  kind: AutomaticMessageKind;
  enabled: boolean;
  body: string;
  template_name: string | null;
  template_language: string | null;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// Secrets and integrations
// ---------------------------------------------------------------------------

export interface SecretRow {
  id: string;
  restaurant_id: string;
  kind: SecretKind;
  ciphertext: Uint8Array;
  iv: Uint8Array;
  wrapped_key: Uint8Array;
  kek_version: number;
  last4: string;
  created_at: Date;
}

export interface IntegrationWhatsappRow {
  restaurant_id: string;
  base_url: string;
  api_key_secret_id: string;
  /** Nullable since migration 0019 (ADR-021). */
  webhook_secret_id: string | null;
  phone_number_id: string;
  status: IntegrationStatus;
  last_error: string | null;
  last_sync_cursor: Date | null;
  last_synced_at: Date | null;
  /** Migration 0019 (ADR-021, FR-170, FR-175, FR-176). */
  uatis_webhook_id: string | null;
  /** ADR-023. Null exactly when `uatis_webhook_id` is null. */
  uatis_webhook_mode: "push" | "pull" | null;
  uatis_organization_id: string | null;
  uatis_feed_cursor: string | null;
  last_webhook_at: Date | null;
  /** Last timestamp poll (migration 0019, ADR-023). */
  last_polled_at: Date | null;
  updated_at: Date;
}

/** `uatis_event_receipts` (migration 0019, ADR-023). */
export interface UatisEventReceiptRow {
  restaurant_id: string;
  event_id: string;
  event_type: string;
  source: "push" | "pull";
  received_at: Date;
}

export interface IntegrationFiscalRow {
  restaurant_id: string;
  base_url: string;
  api_key_secret_id: string;
  webhook_secret_id: string;
  environment: FiscalEnvironment;
  nfce_serie: number;
  nfe_serie: number;
  default_ncm: string;
  default_cfop: string;
  default_csosn: string | null;
  default_pis_cst: string;
  default_cofins_cst: string;
  delivery_fee_mode: DeliveryFeeMode;
  status: IntegrationStatus;
  last_error: string | null;
  updated_at: Date;
}

export interface ApiKeyRow {
  id: string;
  restaurant_id: string;
  name: string;
  prefix: string;
  /** Hex SHA-256 of the full key. */
  hash: string;
  environment: ApiKeyEnvironment;
  created_by: string | null;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

/** One row of `mt.api_key_lookup(hash)`. */
export interface ApiKeyLookupRow {
  id: string;
  restaurant_id: string;
  environment: ApiKeyEnvironment;
  revoked_at: Date | null;
}

/** One row of `mt.memberships_for_user(user_id)`. */
export interface MembershipRow {
  restaurant_id: string;
  role: MemberRole;
}

// ---------------------------------------------------------------------------
// Customers and conversations
// ---------------------------------------------------------------------------

/** The structured address shared by customers and orders (ADR-016). */
export interface AddressColumns {
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  codigo_municipio: string | null;
}

export interface CustomerRow extends AddressColumns {
  id: string;
  restaurant_id: string;
  name: string;
  /** E.164. */
  phone: string;
  email: string | null;
  cpf_cnpj: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ConversationRow {
  id: string;
  restaurant_id: string;
  customer_id: string;
  external_id: string | null;
  last_message_at: Date | null;
  last_message_preview: string | null;
  unread_count: number;
  last_inbound_at: Date | null;
  closed_notice_sent_at: Date | null;
  /** AI assistant state (FR-182, FR-189, FR-190, migration 0020). */
  ai_mode: AiMode;
  ai_paused_at: Date | null;
  ai_pause_reason: AiPauseReason | null;
  ai_pause_note: string | null;
  /** The turn claim that keeps two AI jobs off one conversation. */
  ai_turn_claimed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface MessageRow {
  id: string;
  restaurant_id: string;
  conversation_id: string;
  direction: MessageDirection;
  body: string;
  status: MessageStatus;
  external_id: string | null;
  order_id: string | null;
  sent_by: string | null;
  automatic_kind: AutomaticMessageKind | null;
  template_name: string | null;
  template_language: string | null;
  /** Set by the send consumer right before the call; at-most-once (ADR-017 #4, migration 0015). */
  send_claimed_at: Date | null;
  error_code: string | null;
  error_message: string | null;
  /** The AI run that wrote this reply (FR-192, migration 0020). */
  ai_run_id: string | null;
  created_at: Date;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

export interface MenuItemRow {
  id: string;
  restaurant_id: string;
  kind: MenuItemKind;
  name: string;
  description: string | null;
  category: MenuCategory;
  price_cents: number;
  calories: number | null;
  volume: string | null;
  available: boolean;
  popular: boolean;
  available_weekdays: Weekday[];
  image_url: string | null;
  /** Set by "Excluir" (FR-057, ADR-018); archived items leave lists and new orders. */
  archived_at: Date | null;
  ncm: string | null;
  cfop: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface MenuItemSizeRow {
  id: string;
  restaurant_id: string;
  menu_item_id: string;
  name: string;
  price_cents: number;
  position: number;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export interface OrderCounterRow {
  restaurant_id: string;
  last_value: number;
}

export interface OrderRow extends AddressColumns {
  id: string;
  restaurant_id: string;
  /** `ORD-NNN`. */
  code: string;
  customer_id: string;
  status: OrderStatus;
  fulfillment: Fulfillment;
  /** Null = "A definir": the AI assistant never asks for it (FR-188, migration 0020). */
  payment_method: PaymentMethod | null;
  change_for_cents: number | null;
  notes: string | null;
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  source: OrderSource;
  conversation_id: string | null;
  created_by: string | null;
  created_by_api_key: string | null;
  created_at: Date;
  updated_at: Date;
  delivered_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  /** ADR-020: set on `entregue` when null, or by "Marcar como pago". Paid = set and not `cancelado`. */
  paid_at: Date | null;
  paid_by: string | null;
  /** The AI run that placed this order (FR-193, migration 0020). */
  ai_run_id: string | null;
}

export interface OrderItemRow {
  id: string;
  restaurant_id: string;
  order_id: string;
  menu_item_id: string | null;
  name: string;
  size_name: string | null;
  unit_price_cents: number;
  qty: number;
  /** Generated: unit_price_cents * qty. */
  line_total_cents: number;
  notes: string | null;
  position: number;
}

export interface OrderStatusHistoryRow {
  id: string;
  restaurant_id: string;
  order_id: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  changed_by: string | null;
  actor_type: StatusActorType;
  changed_at: Date;
}

export interface OrderInvoiceRow {
  id: string;
  restaurant_id: string;
  order_id: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  external_id: string | null;
  numero: number | null;
  serie: number | null;
  chave_acesso: string | null;
  error_code: string | null;
  error_message: string | null;
  request_payload: Json | null;
  created_by: string | null;
  cancel_requested_at: Date | null;
  cancel_requested_by: string | null;
  cancel_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

export interface StockItemRow {
  id: string;
  restaurant_id: string;
  name: string;
  unit: string;
  category: StockCategory;
  /** numeric(12,3) as text. */
  current_qty: string;
  minimum_qty: string;
  unit_cost_cents: number;
  /** Archived items leave the stock lists (ADR-018). */
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface StockMovementRow {
  id: string;
  restaurant_id: string;
  stock_item_id: string;
  kind: StockMovementKind;
  /** numeric(12,3) as text. Signed for `adjust`. */
  qty: string;
  balance_after: string;
  reason: string | null;
  created_by: string | null;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Webhooks, jobs, audit, usage
// ---------------------------------------------------------------------------

export interface WebhookEndpointRow {
  id: string;
  restaurant_id: string;
  url: string;
  secret_id: string;
  enabled: boolean;
  events: WebhookEvent[];
  created_at: Date;
  updated_at: Date;
}

export interface WebhookDeliveryRow {
  id: string;
  restaurant_id: string;
  endpoint_id: string;
  event: WebhookEvent;
  payload: Json;
  status: WebhookDeliveryStatus;
  attempts: number;
  last_status_code: number | null;
  last_error: string | null;
  next_attempt_at: Date | null;
  delivered_at: Date | null;
  created_at: Date;
}

export interface IdempotencyRecordRow {
  restaurant_id: string;
  idempotency_key: string;
  request_hash: string;
  response_status: number;
  response_body: Json;
  created_at: Date;
}

export interface RateCounterRow {
  subject_id: string;
  class: RateClass;
  window_start: Date;
  count: number;
}

export interface JobAttemptRow {
  id: string;
  restaurant_id: string;
  queue: JobQueue;
  msg_id: number | null;
  subject_type: JobSubjectType;
  subject_id: string | null;
  attempt_no: number;
  outcome: JobOutcome;
  http_status: number | null;
  error_code: string | null;
  duration_ms: number | null;
  created_at: Date;
}

export interface AuditLogRow {
  id: string;
  restaurant_id: string;
  actor_type: StatusActorType;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  context: Json;
  created_at: Date;
}

export interface UsageEventRow {
  id: string;
  restaurant_id: string;
  kind: UsageEventKind;
  ref_id: string;
  occurred_at: Date;
}

// ---------------------------------------------------------------------------
// AI order assistant (migration 0020, 12.ai-order-assistant.md)
// ---------------------------------------------------------------------------

export interface AiSettingsRow {
  restaurant_id: string;
  enabled: boolean;
  persona_name: string;
  extra_instructions: string | null;
  auto_resume_minutes: number;
  allow_overage: boolean;
  monthly_hard_cap: number;
  updated_at: Date;
}

export interface AiCartRow {
  id: string;
  restaurant_id: string;
  conversation_id: string;
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
  created_at: Date;
  updated_at: Date;
}

export interface AiRunRow {
  id: string;
  restaurant_id: string;
  conversation_id: string;
  trigger_message_id: string;
  status:
    | "running"
    | "replied"
    | "silent"
    | "superseded"
    | "paused"
    | "answered"
    | "stale"
    | "blocked"
    | "locked"
    | "stopped"
    | "failed";
  model: string | null;
  model_calls: number;
  input_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  billed_as: "included" | "overage" | null;
  tool_calls: { name: string; ok: boolean; error_code: string | null }[];
  stop_reason: string | null;
  error_code: string | null;
  started_at: Date;
  finished_at: Date | null;
}

// ---------------------------------------------------------------------------
// Table registry
// ---------------------------------------------------------------------------

/** Every table, mapped to its row type. */
export interface Tables {
  plans: PlanRow;
  restaurants: RestaurantRow;
  restaurant_members: RestaurantMemberRow;
  restaurant_settings: RestaurantSettingsRow;
  business_hours: BusinessHoursRow;
  automatic_messages: AutomaticMessageRow;
  secrets: SecretRow;
  integrations_whatsapp: IntegrationWhatsappRow;
  integrations_fiscal: IntegrationFiscalRow;
  api_keys: ApiKeyRow;
  customers: CustomerRow;
  conversations: ConversationRow;
  messages: MessageRow;
  menu_items: MenuItemRow;
  menu_item_sizes: MenuItemSizeRow;
  order_counters: OrderCounterRow;
  orders: OrderRow;
  order_items: OrderItemRow;
  order_status_history: OrderStatusHistoryRow;
  order_invoices: OrderInvoiceRow;
  stock_items: StockItemRow;
  stock_movements: StockMovementRow;
  webhook_endpoints: WebhookEndpointRow;
  webhook_deliveries: WebhookDeliveryRow;
  idempotency_records: IdempotencyRecordRow;
  rate_counters: RateCounterRow;
  job_attempts: JobAttemptRow;
  audit_logs: AuditLogRow;
  ai_settings: AiSettingsRow;
  ai_carts: AiCartRow;
  ai_runs: AiRunRow;
  usage_events: UsageEventRow;
  uatis_event_receipts: UatisEventReceiptRow;
}

export type TableName = keyof Tables;

/**
 * Every table with a tenant key, in dependency order. The isolation tests loop
 * over this list (NFR-001), and a meta-test fails when the database has a
 * tenant table this list lacks.
 */
export const TENANT_TABLES = [
  "restaurants",
  "restaurant_members",
  "restaurant_settings",
  "business_hours",
  "automatic_messages",
  "secrets",
  "integrations_whatsapp",
  "integrations_fiscal",
  "api_keys",
  "customers",
  "conversations",
  "messages",
  "menu_items",
  "menu_item_sizes",
  "order_counters",
  "orders",
  "order_items",
  "order_status_history",
  "order_invoices",
  "stock_items",
  "stock_movements",
  "webhook_endpoints",
  "webhook_deliveries",
  "idempotency_records",
  "job_attempts",
  "audit_logs",
  "ai_settings",
  "ai_runs",
  "ai_carts",
  "usage_events",
  "uatis_event_receipts",
] as const satisfies readonly TableName[];

export type TenantTable = (typeof TENANT_TABLES)[number];

/** Tables without a tenant key. Both still have RLS forced. */
export const GLOBAL_TABLES = ["plans", "rate_counters"] as const satisfies readonly TableName[];

/** The only tables `authenticated` may read (Realtime, ADR-004, ADR-017 and its Amendment 1). */
export const REALTIME_TABLES = [
  "orders",
  "messages",
  "conversations",
  "order_invoices",
] as const satisfies readonly TenantTable[];

/**
 * Realtime tables `authenticated` reads by column only (migration 0017). `order_invoices` hides
 * `request_payload` (CPF/CNPJ, address), the error text, and the cancel reason from the browser.
 */
export const REALTIME_COLUMN_GRANTS = {
  order_invoices: ["id", "restaurant_id", "order_id", "kind", "status", "created_at", "updated_at"],
} as const satisfies Partial<Record<(typeof REALTIME_TABLES)[number], readonly string[]>>;
