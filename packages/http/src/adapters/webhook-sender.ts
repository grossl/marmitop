// The WebhookSender adapter (FR-147, FR-148; ADR-009; 07.security.md "Outbound webhook
// signing"). It signs the exact body string with a fresh `t` on every attempt and POSTs it
// through `safeFetch`: the SSRF guard, a 10-second timeout, no redirects. Any HTTP answer
// resolves with its status; the worker handler decides delivered or retry.

import {
  buildOutboundWebhookHeaders,
  type Clock,
  systemClock,
  type WebhookDelivery,
  type WebhookResult,
  type WebhookSender,
} from "@mt/core";

import type { SafeFetch } from "./safe-fetch";

export const WEBHOOK_USER_AGENT = "Marmitop-Webhooks/1";

export interface SafeFetchWebhookSenderOptions {
  readonly fetch: SafeFetch;
  readonly clock?: Clock;
}

export class SafeFetchWebhookSender implements WebhookSender {
  private readonly fetch: SafeFetch;
  private readonly clock: Clock;

  constructor(options: SafeFetchWebhookSenderOptions) {
    this.fetch = options.fetch;
    this.clock = options.clock ?? systemClock;
  }

  async send(delivery: WebhookDelivery): Promise<WebhookResult> {
    const headers = buildOutboundWebhookHeaders({
      secret: delivery.secret,
      event: delivery.event,
      deliveryId: delivery.deliveryId,
      body: delivery.body,
      now: this.clock.now(),
    });
    const response = await this.fetch({
      method: "POST",
      url: delivery.url,
      headers: { ...headers, "User-Agent": WEBHOOK_USER_AGENT },
      body: delivery.body,
    });
    return { statusCode: response.status };
  }
}
