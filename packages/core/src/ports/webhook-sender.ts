// WebhookSender port (ADR-009; FR-147, FR-148). The real adapter does a signed fetch with a
// 10 second timeout, no redirects, and the SSRF guard.

export interface WebhookDelivery {
  readonly url: string;
  /** Plaintext signing secret, decrypted for this call only. */
  readonly secret: string;
  readonly event: string;
  readonly deliveryId: string;
  /** The exact body string. It is signed and sent byte for byte. */
  readonly body: string;
}

export interface WebhookResult {
  readonly statusCode: number;
}

export interface WebhookSender {
  /** Resolves with the status code for any HTTP answer; throws `GatewayError` for timeout, refusal, or a blocked host. */
  send(delivery: WebhookDelivery): Promise<WebhookResult>;
}
