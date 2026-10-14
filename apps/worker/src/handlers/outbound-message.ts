// mt_outbound_messages: send one `pending` message through backend-uatis
// (FR-101, FR-108, FR-117; ADR-014, ADR-017 #4).
//
// At-most-once: `store.claim` sets `messages.send_claimed_at` in its own
// committed transaction before the HTTP call. A message that is already
// claimed is never sent again; it becomes `failed` / `ambiguous`. Only a
// connection error before the request left releases the claim and retries.
//
//   claim ─ skip (not pending, already sent, gone) ──────────▶ ok
//         ─ already_claimed ────────────────────────────────▶ failed ambiguous
//         ─ not_configured ─────────────────────────────────▶ failed whatsapp_not_configured
//         ─ claimed ─▶ send ─ 201 ──────────────────────────▶ sent + external_id
//                           ─ connection error ─────────────▶ release, retry
//                           ─ timeout / 5xx / broken socket ▶ failed ambiguous
//                           ─ 4xx (outside window, …) ──────▶ failed <code>

import {
  classifyOutboundSend,
  GatewayError,
  nextMessageStatus,
  type MessageStatus,
  type WhatsAppGateway,
} from "@mt/core";
import type { GatewayConnection } from "@mt/http";
import { QUEUES } from "@mt/db";
import { type OutboundMessageJob, outboundMessageJobSchema } from "@mt/schemas";

import type { JobHandler, JobOutcome } from "../framework/types";

export interface ClaimedMessage {
  /** Customer phone, E.164. */
  readonly to: string;
  readonly body: string;
  readonly template: { readonly name: string; readonly language: string } | null;
}

export interface SendConnection extends GatewayConnection {
  readonly phoneNumberId: string;
}

export type ClaimResult =
  | { readonly kind: "claimed"; readonly message: ClaimedMessage; readonly connection: SendConnection }
  | { readonly kind: "skip"; readonly reason: "not_found" | "not_pending" | "already_sent" }
  | { readonly kind: "already_claimed" }
  | { readonly kind: "not_configured" };

export interface OutboundStore {
  claim(restaurantId: string, messageId: string): Promise<ClaimResult>;
  markSent(restaurantId: string, messageId: string, externalId: string, status: MessageStatus): Promise<void>;
  markFailed(restaurantId: string, messageId: string, errorCode: string, errorMessage: string): Promise<void>;
  /** Clears the claim before a retry: the request never left. */
  release(restaurantId: string, messageId: string): Promise<void>;
}

/** Allow-listed pt-BR text for `messages.error_message` (max 200 characters; NFR-011). */
export function sendErrorMessage(code: string): string {
  switch (code) {
    case "outside_service_window":
      return "Fora da janela de 24h.";
    case "whatsapp_disconnected":
      return "A linha do WhatsApp está desconectada.";
    case "whatsapp_not_configured":
      return "O WhatsApp não está configurado.";
    case "ambiguous":
      return "Envio incerto: confira no WhatsApp antes de reenviar.";
    case "unauthorized":
    case "forbidden":
      return "A chave do backend-uatis foi recusada.";
    case "host_not_allowed":
      return "Endereço do backend-uatis não permitido.";
    default:
      return "O envio falhou.";
  }
}

export interface OutboundHandlerDeps {
  readonly store: OutboundStore;
  readonly gatewayFor: (conn: GatewayConnection) => WhatsAppGateway;
}

export function createOutboundMessageHandler(deps: OutboundHandlerDeps): JobHandler<OutboundMessageJob> {
  const { store } = deps;
  const fail = async (job: OutboundMessageJob, errorCode: string, httpStatus?: number): Promise<JobOutcome> => {
    await store.markFailed(job.restaurantId, job.messageId, errorCode, sendErrorMessage(errorCode));
    return { kind: "fail", errorCode, ...(httpStatus !== undefined ? { httpStatus } : {}) };
  };

  return {
    name: "whatsapp.send",
    queue: QUEUES.outboundMessages,
    schema: outboundMessageJobSchema,
    subjectType: "message",
    subjectId: (job) => job.messageId,

    async run({ payload: job }) {
      const claim = await store.claim(job.restaurantId, job.messageId);
      if (claim.kind === "skip") return { kind: "ok" };
      if (claim.kind === "already_claimed") return fail(job, "ambiguous");
      if (claim.kind === "not_configured") return fail(job, "whatsapp_not_configured");

      const { message, connection } = claim;
      const gateway = deps.gatewayFor({ baseUrl: connection.baseUrl, apiKey: connection.apiKey });
      try {
        const result = message.template
          ? await gateway.sendTemplate({
              to: message.to,
              fromAddress: connection.phoneNumberId,
              templateName: message.template.name,
              language: message.template.language,
            })
          : await gateway.sendText({ to: message.to, fromAddress: connection.phoneNumberId, body: message.body });
        // backend-uatis answers `pending` (queued for Meta); for Marmitop the message is `sent` (FR-101).
        await store.markSent(
          job.restaurantId,
          job.messageId,
          result.externalId,
          nextMessageStatus("sent", result.status),
        );
        return { kind: "ok" };
      } catch (error) {
        if (!(error instanceof GatewayError)) return fail(job, "ambiguous");
        const httpStatus = error.failure.kind === "http" ? error.failure.status : undefined;
        const classified = classifyOutboundSend(error.failure);
        if (classified.failure === "transient") {
          await store.release(job.restaurantId, job.messageId);
          return {
            kind: "retry",
            errorCode: classified.errorCode,
            ...(httpStatus !== undefined ? { httpStatus } : {}),
            ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
          };
        }
        return fail(job, classified.errorCode, httpStatus);
      }
    },

    async onExhausted({ payload: job }, last) {
      await store.markFailed(job.restaurantId, job.messageId, last.errorCode, sendErrorMessage(last.errorCode));
    },
  };
}
