// FakeWebhookSender: records deliveries with the headers the real adapter would send (FR-147).

import { type Clock, systemClock } from "../ports/clock";
import type { WebhookDelivery, WebhookResult, WebhookSender } from "../ports/webhook-sender";
import { buildOutboundWebhookHeaders } from "../webhook-signature";

export interface RecordedDelivery {
  readonly delivery: WebhookDelivery;
  readonly headers: Record<string, string>;
}

export interface ScriptedWebhook {
  readonly statusCode?: number;
  readonly error?: Error;
}

export class FakeWebhookSender implements WebhookSender {
  readonly deliveries: RecordedDelivery[] = [];
  private readonly scripted: ScriptedWebhook[] = [];
  private readonly clock: Clock;

  constructor(options: { clock?: Clock } = {}) {
    this.clock = options.clock ?? systemClock;
  }

  scriptNext(script: ScriptedWebhook): this {
    this.scripted.push(script);
    return this;
  }

  async send(delivery: WebhookDelivery): Promise<WebhookResult> {
    const headers = buildOutboundWebhookHeaders({
      secret: delivery.secret,
      event: delivery.event,
      deliveryId: delivery.deliveryId,
      body: delivery.body,
      now: this.clock.now(),
    });
    this.deliveries.push({ delivery, headers });
    const script = this.scripted.shift();
    if (script?.error) throw script.error;
    return { statusCode: script?.statusCode ?? 200 };
  }
}
