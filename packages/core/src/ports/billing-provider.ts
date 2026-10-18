// BillingProvider port (ADR-008; FR-150..FR-156). v1 has one adapter: NullBillingProvider.

export type UsageKind = "order.created" | "message.sent" | "invoice.issued" | "ai.reply";

export interface UsageEvent {
  readonly restaurantId: string;
  readonly kind: UsageKind;
  /** The order, message, or invoice id. (kind, refId) is unique, so a retry never counts twice. */
  readonly refId: string;
  readonly occurredAt: Date;
}

/** Mirrors the `plans` row. */
export interface Plan {
  readonly code: string;
  readonly name: string;
  readonly includedOrdersMonth: number;
  readonly includedMessagesMonth: number;
  readonly includedInvoicesMonth: number;
  readonly priceDisplay: string;
}

export interface BillingInvoice {
  readonly id: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly amountCents: number;
  readonly status: "open" | "paid" | "void";
}

export interface BillingProvider {
  getPlan(restaurantId: string): Promise<Plan | null>;
  listInvoices(restaurantId: string): Promise<readonly BillingInvoice[]>;
  recordUsage(event: UsageEvent): Promise<void>;
}
