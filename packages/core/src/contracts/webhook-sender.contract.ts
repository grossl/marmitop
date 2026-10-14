// Contract suite for WebhookSender (ADR-009). The harness points the sender at a target that answers 2xx.

import { describe, expect, test } from "bun:test";
import type { WebhookSender } from "../ports/webhook-sender";

export function webhookSenderContract(
  name: string,
  create: () => Promise<{ sender: WebhookSender; url: string; cleanup?: () => Promise<void> }>,
): void {
  describe(`WebhookSender contract: ${name}`, () => {
    test("send resolves with the integer HTTP status of the answer", async () => {
      const { sender, url, cleanup } = await create();
      try {
        const r = await sender.send({
          url,
          secret: "whsec_contract",
          event: "order.created",
          deliveryId: "d-1",
          body: '{"id":"d-1","type":"order.created"}',
        });
        expect(Number.isInteger(r.statusCode)).toBe(true);
        expect(r.statusCode).toBeGreaterThanOrEqual(200);
        expect(r.statusCode).toBeLessThan(300);
      } finally {
        await cleanup?.();
      }
    });
  });
}
