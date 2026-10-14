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
}
