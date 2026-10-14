// mt_webhook_deliveries: sign and POST one outbound webhook delivery (FR-146..FR-148;
// ADR-007, ADR-009; 06.api-spec.md "Outbound webhooks"; 07.security.md).
//
//   load ─ missing, delivered, exhausted ─────────────────────────▶ ok (skip, no send)
//        ─ endpoint disabled ─────────────────────────────────────▶ exhausted endpoint_disabled
//        ─ send ─ 2xx ────────────────────────────────────────────▶ delivered
//               ─ refused by the SSRF guard (nothing left) ───────▶ exhausted host_not_allowed
//               ─ any other status, timeout, network error ───────▶ failed + next_attempt_at, retry
//                                                   sixth attempt ▶ exhausted
//
// A webhook delivery is idempotent for the receiver (`X-Marmitop-Delivery`), so every
// failure but a refusal retries. The attempt number comes from the stored row, not the
// job, so a job the sweep re-enqueued keeps the schedule. Every attempt updates the row
// here; the framework writes the `job_attempts` row.

import { type Clock, decideAfterFailure, GatewayError, MAX_ATTEMPTS, type WebhookSender } from "@mt/core";
import { QUEUES } from "@mt/db";
import { type WebhookDeliveryJob, webhookDeliveryJobSchema } from "@mt/schemas";

import type { JobHandler, JobOutcome } from "../framework/types";

export type DeliveryStatus = "pending" | "delivered" | "failed" | "exhausted";

export interface LoadedDelivery {
  readonly status: DeliveryStatus;
  readonly attempts: number;
  readonly event: string;
  /** The stored payload, serialized. Sent and signed byte for byte. */
  readonly body: string;
  readonly endpoint: { readonly url: string; readonly enabled: boolean; readonly secret: string };
}

export interface DeliveryAttempt {
  readonly attemptNo: number;
  readonly status: "delivered" | "failed" | "exhausted";
  readonly statusCode: number | null;
  /** Allow-listed code, never response text (05.data-model.md: max 200 characters). */
  readonly error: string | null;
  readonly nextAttemptAt: Date | null;
  readonly at: Date;
}

export interface WebhookDeliveryStore {
  load(restaurantId: string, deliveryId: string): Promise<LoadedDelivery | null>;
  recordAttempt(restaurantId: string, deliveryId: string, attempt: DeliveryAttempt): Promise<void>;
  /** Sets `exhausted` when the delivery is still `pending` or `failed`. */
  markExhausted(restaurantId: string, deliveryId: string, errorCode: string): Promise<void>;
}

export interface WebhookDeliveryHandlerDeps {
  readonly store: WebhookDeliveryStore;
  readonly sender: WebhookSender;
  readonly clock: Clock;
}

function errorCodeOf(error: unknown): { code: string; refused: boolean } {
  if (!(error instanceof GatewayError)) return { code: "internal_error", refused: false };
  const f = error.failure;
  switch (f.kind) {
    case "refused":
      return { code: f.code, refused: true };
    case "http":
      return { code: f.code ?? `http_${f.status}`, refused: false };
    case "timeout":
      return { code: "timeout", refused: false };
    case "connection_error":
      return { code: "connection_error", refused: false };
    case "network_error":
      return { code: "network_error", refused: false };
  }
}

export function createWebhookDeliveryHandler(deps: WebhookDeliveryHandlerDeps): JobHandler<WebhookDeliveryJob> {
  const { store, sender, clock } = deps;

  return {
    name: "webhooks.deliver",
    queue: QUEUES.webhookDeliveries,
    schema: webhookDeliveryJobSchema,
    subjectType: "webhook_delivery",
    subjectId: (job) => job.deliveryId,

    async run({ payload: job }): Promise<JobOutcome> {
      const delivery = await store.load(job.restaurantId, job.deliveryId);
      if (delivery === null || delivery.status === "delivered" || delivery.status === "exhausted") {
        return { kind: "ok" };
      }
      const attemptNo = delivery.attempts + 1;
      const record = (a: Omit<DeliveryAttempt, "attemptNo" | "at">) =>
        store.recordAttempt(job.restaurantId, job.deliveryId, { attemptNo, ...a, at: clock.now() });

      if (!delivery.endpoint.enabled) {
        await record({ status: "exhausted", statusCode: null, error: "endpoint_disabled", nextAttemptAt: null });
        return { kind: "fail", errorCode: "endpoint_disabled" };
      }

      let statusCode: number | null = null;
      let errorCode: string;
      try {
        const result = await sender.send({
          url: delivery.endpoint.url,
          secret: delivery.endpoint.secret,
          event: delivery.event,
          deliveryId: job.deliveryId,
          body: delivery.body,
        });
        statusCode = result.statusCode;
        if (statusCode >= 200 && statusCode < 300) {
          await record({ status: "delivered", statusCode, error: null, nextAttemptAt: null });
          return { kind: "ok", httpStatus: statusCode };
        }
        errorCode = `http_${statusCode}`;
      } catch (error) {
        const classified = errorCodeOf(error);
        errorCode = classified.code;
        if (classified.refused) {
          await record({ status: "exhausted", statusCode: null, error: errorCode, nextAttemptAt: null });
          return { kind: "fail", errorCode };
        }
      }

      const http = statusCode !== null ? { httpStatus: statusCode } : {};
      const decision =
        attemptNo >= MAX_ATTEMPTS
          ? ({ action: "fail" } as const)
          : decideAfterFailure({ attemptNo, failure: "transient" });
      if (decision.action === "retry") {
        const nextAttemptAt = new Date(clock.now().getTime() + decision.delayMs);
        await record({ status: "failed", statusCode, error: errorCode, nextAttemptAt });
        return { kind: "retry", errorCode, ...http };
      }
      await record({ status: "exhausted", statusCode, error: errorCode, nextAttemptAt: null });
      return { kind: "fail", errorCode, ...http };
    },

    async onExhausted({ payload: job }, last) {
      await store.markExhausted(job.restaurantId, job.deliveryId, last.errorCode);
    },
  };
}
