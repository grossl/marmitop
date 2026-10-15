// WhatsAppGateway port (ADR-002, ADR-014; FR-100, FR-101). Adapters: UatisGateway (http), FakeGateway.

import type { GatewayMessage, MessageDirection, MessageStatus } from "../uatis-mapping";

export interface SendTextInput {
  /** E.164. */
  readonly to: string;
  /** The sending number in backend-uatis (`phone_number_id`). */
  readonly fromAddress: string;
  readonly body: string;
}

export interface SendTemplateInput {
  readonly to: string;
  readonly fromAddress: string;
  readonly templateName: string;
  readonly language: string;
}

export interface SendResult {
  readonly externalId: string;
  readonly status: MessageStatus;
}

export interface ListMessagesInput {
  /** Newest `created_at` seen, minus the 60 second overlap (ADR-002 Amendment 1). */
  readonly from?: Date;
  readonly direction?: MessageDirection;
  /** Opaque cursor from a previous page. */
  readonly cursor?: string | null;
  readonly limit?: number;
}

export interface ListMessagesResult {
  readonly items: readonly GatewayMessage[];
  readonly nextCursor: string | null;
}

export interface ApprovedTemplate {
  readonly name: string;
  readonly language: string;
}

/** `GET /v1/organizations/current` (ADR-021). */
export interface UatisOrganization {
  readonly id: string;
  readonly name: string;
}

/** The backend-uatis webhook events Marmitop subscribes to (ADR-021). */
export type UatisWebhookEventName = "message.created" | "message.updated" | "conversation.updated";

/** ADR-023: `push` POSTs each event to `url`; `pull` has no URL and is read through the event feed. */
export type UatisWebhookMode = "push" | "pull";

export type CreateWebhookInput =
  | {
      readonly mode: "push";
      readonly url: string;
      readonly events: readonly UatisWebhookEventName[];
      readonly description: string | null;
    }
  | {
      readonly mode: "pull";
      readonly url: null;
      readonly events: readonly UatisWebhookEventName[];
      readonly description: string | null;
    };

/**
 * `POST /v1/webhooks` 201. A push webhook's `secret` is returned this once and never again
 * (backend-uatis FR-051). A pull webhook has neither URL nor secret (ADR-023).
 */
export interface CreatedUatisWebhook {
  readonly id: string;
  readonly mode: UatisWebhookMode;
  readonly url: string | null;
  readonly events: readonly string[];
  readonly status: "active" | "disabled";
  readonly secret: string | null;
}

/**
 * One feed item of `GET /v1/webhooks/{id}/events` (ADR-023). `event` is the raw envelope,
 * `{ id, type, created_at, organization_id, data }`, the same bytes a push carries; the
 * caller parses it with `parseUatisWebhookEvent`.
 */
export interface UatisFeedEvent {
  readonly cursor: string;
  readonly event: unknown;
}

/**
 * `next_cursor` is the last event's cursor; with no new events backend-uatis echoes the `after`
 * that was sent (null when none). It never means "more pages": a full page (`events.length ===
 * limit`) does.
 */
export interface UatisFeedPage {
  /** Oldest first. */
  readonly events: readonly UatisFeedEvent[];
  readonly nextCursor: string | null;
}

/** `GET /v1/webhooks/{id}` (ADR-023): every read carries `mode`; `url` is null for pull. */
export interface UatisWebhookInfo {
  readonly id: string;
  readonly mode: UatisWebhookMode;
  readonly url: string | null;
  readonly status: "active" | "disabled";
}

/** One `GET /v1/webhooks/{id}/deliveries` item (backend-uatis `deliverySchema`). */
export interface UatisWebhookDelivery {
  readonly id: string;
  readonly eventType: string;
  readonly status: "pending" | "delivered" | "failed" | "exhausted";
  readonly attemptNo: number;
  readonly httpStatus: number | null;
  readonly durationMs: number | null;
  readonly createdAt: Date;
  readonly deliveredAt: Date | null;
}

export type ConnectionCheck = { readonly ok: true } | { readonly ok: false; readonly error: string };

/**
 * Failures throw `GatewayError`. `sendText` and `sendTemplate` are at-most-once for the caller
 * once the request has left (ADR-017): the port has no idempotency key.
 */
export interface WhatsAppGateway {
  sendText(input: SendTextInput): Promise<SendResult>;
  sendTemplate(input: SendTemplateInput): Promise<SendResult>;
  listMessages(input?: ListMessagesInput): Promise<ListMessagesResult>;
  listApprovedTemplates(): Promise<readonly ApprovedTemplate[]>;
  /** FR-086: one cheap call that proves the base URL and key work. */
  testConnection(): Promise<ConnectionCheck>;
  /** The organization the API key belongs to (ADR-021, FR-170). */
  getOrganization(): Promise<UatisOrganization>;
  /** Registers a webhook; needs an admin API key at backend-uatis (FR-170). */
  createWebhook(input: CreateWebhookInput): Promise<CreatedUatisWebhook>;
  /** Null when backend-uatis answers 404. Tells a missing webhook from a feed that does not exist. */
  getWebhook(webhookId: string): Promise<UatisWebhookInfo | null>;
  /** `{ deleted: false }` when backend-uatis answers 404: the webhook is already gone (FR-171, FR-173). */
  deleteWebhook(webhookId: string): Promise<{ readonly deleted: boolean }>;
  /** Newest first. An unknown webhook throws a 404 GatewayError (FR-178). */
  listWebhookDeliveries(webhookId: string, options?: { readonly limit?: number }): Promise<readonly UatisWebhookDelivery[]>;
  /**
   * The event feed (ADR-023, FR-174). `410 cursor_expired`, `400` for a foreign cursor, and `404`
   * throw a GatewayError with that status; the caller resets the cursor or falls back to
   * `listMessages`. Needs an API key with role admin or higher (`403` otherwise).
   */
  listWebhookEvents(
    webhookId: string,
    options: { readonly after: string | null; readonly limit?: number },
  ): Promise<UatisFeedPage>;
}
