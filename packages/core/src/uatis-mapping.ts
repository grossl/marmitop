// backend-uatis payload mapping (ADR-002 Amendment 1, 06.api-spec.md). Pure.
// Webhook events and `GET /v1/messages` items share one message shape, so both map here.

import { normalizePhoneE164 } from "./br-documents";
import { AppError } from "./errors";

export type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";
export type MessageDirection = "in" | "out";

/** Inbound content that is not text is stored with this body (ADR-002 Amendment 1). */
export const UNSUPPORTED_MEDIA_BODY = "[mídia não suportada]";

/** The internal shape of a backend-uatis message. */
export interface GatewayMessage {
  readonly externalId: string;
  readonly conversationExternalId: string | null;
  readonly direction: MessageDirection;
  readonly body: string;
  readonly contentType: "text" | "unsupported";
  /** Null when backend-uatis sent a state Marmitop does not know. Callers leave the stored status alone. */
  readonly status: MessageStatus | null;
  /** E.164 when it can be normalized; the raw value otherwise; null when absent. */
  readonly contactAddress: string | null;
  readonly createdAt: Date;
}

export type UatisWebhookEvent =
  | {
      readonly type: "message.created" | "message.updated";
      readonly deliveryId: string | null;
      readonly occurredAt: Date | null;
      readonly message: GatewayMessage;
    }
  | { readonly type: "conversation.updated" }
  | { readonly type: "ignored"; readonly eventType: string };

function invalid(path: string, message: string): AppError {
  return new AppError("validation_failed", "The webhook payload is invalid.", {
    details: [{ path, code: "invalid", message }],
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function date(v: unknown, path: string): Date {
  const text = str(v);
  const d = text ? new Date(text) : null;
  if (!d || Number.isNaN(d.getTime())) throw invalid(path, "Expected an ISO timestamp.");
  return d;
}

const STATES: Readonly<Record<string, MessageStatus>> = {
  pending: "pending",
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
  // backend-uatis reports inbound messages as `received`; Marmitop stores `delivered`.
  received: "delivered",
};

function mapStatus(status: unknown): MessageStatus | null {
  if (!isRecord(status)) return null;
  const state = status.state;
  return typeof state === "string" ? (STATES[state] ?? null) : null;
}

/** Map one backend-uatis message (webhook `data.message` or a poll item). */
export function mapUatisMessage(raw: unknown): GatewayMessage {
  if (!isRecord(raw)) throw invalid("message", "Expected an object.");
  const externalId = str(raw.id);
  if (!externalId) throw invalid("message.id", "Missing message id.");
  const direction = raw.direction;
  if (direction !== "in" && direction !== "out") throw invalid("message.direction", 'Expected "in" or "out".');
  const content = raw.content;
  const textBody =
    isRecord(content) && content.type === "text" && isRecord(content.text) && typeof content.text.body === "string"
      ? content.text.body
      : null;
  const address = str(raw.contact_address);
  return {
    externalId,
    conversationExternalId: str(raw.conversation_id),
    direction,
    body: textBody ?? UNSUPPORTED_MEDIA_BODY,
    contentType: textBody === null ? "unsupported" : "text",
    status: mapStatus(raw.status),
    contactAddress: address ? (normalizePhoneE164(address) ?? address) : null,
    createdAt: date(raw.created_at, "message.created_at"),
  };
}

/** Parse a verified `POST /v1/webhooks/uatis/{restaurant_id}` body. Call it after the signature check. */
export function parseUatisWebhookEvent(body: unknown): UatisWebhookEvent {
  if (!isRecord(body)) throw invalid("", "Expected a JSON object.");
  const type = str(body.type);
  if (!type) throw invalid("type", "Missing event type.");
  if (type === "conversation.updated") return { type: "conversation.updated" };
  if (type !== "message.created" && type !== "message.updated") return { type: "ignored", eventType: type };
  const data = body.data;
  if (!isRecord(data) || !isRecord(data.message)) throw invalid("data.message", "Missing message.");
  const message = mapUatisMessage(data.message);
  const createdAt = str(body.created_at);
  const occurred = createdAt ? new Date(createdAt) : null;
  return {
    type,
    deliveryId: str(body.id),
    occurredAt: occurred && !Number.isNaN(occurred.getTime()) ? occurred : null,
    message,
  };
}

const RANK: Readonly<Record<"pending" | "sent" | "delivered" | "read", number>> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

/**
 * Status only moves forward (FR-106): pending, sent, delivered, read. `failed` is reachable from
 * pending and sent, and nothing leaves it. An older event never moves a status back.
 */
export function nextMessageStatus(current: MessageStatus, incoming: MessageStatus | null): MessageStatus {
  if (incoming === null || current === "failed") return current;
  if (incoming === "failed") return current === "pending" || current === "sent" ? "failed" : current;
  return RANK[incoming] > RANK[current] ? incoming : current;
}

export function buildUatisSendTextBody(input: { to: string; fromAddress: string; body: string }) {
  return { to: input.to, from_address: input.fromAddress, text: { body: input.body } };
}

export function buildUatisSendTemplateBody(input: {
  to: string;
  fromAddress: string;
  templateName: string;
  language: string;
}) {
  return {
    to: input.to,
    from_address: input.fromAddress,
    template: { name: input.templateName, language: input.language, components: [] as unknown[] },
  };
}

/** The `201` body of `POST /v1/messages`. */
export function parseUatisSendResponse(raw: unknown): { externalId: string; status: MessageStatus } {
  if (!isRecord(raw) || !str(raw.id)) {
    throw new AppError("upstream_error", "backend-uatis returned an unexpected send response.");
  }
  return { externalId: raw.id as string, status: mapStatus(raw.status) ?? "pending" };
}
