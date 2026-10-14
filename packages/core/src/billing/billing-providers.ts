// BillingProvider adapters (ADR-008; FR-150, FR-151, FR-156).
// NullBillingProvider is the only real adapter in v1: it returns the restaurant's plan row and
// an empty invoice list, and hands usage to a sink that writes `usage_events`.
// RecordingBillingProvider is the test double that proves callers depend on the port only.

import type { BillingInvoice, BillingProvider, Plan, UsageEvent } from "../ports/billing-provider";

export interface NullBillingProviderOptions {
  /** Reads the restaurant's `plans` row (through packages/db). */
  readonly loadPlan: (restaurantId: string) => Promise<Plan | null>;
  /** Writes the `usage_events` row. Optional: without it, usage is dropped. */
  readonly writeUsage?: (event: UsageEvent) => Promise<void>;
}

export class NullBillingProvider implements BillingProvider {
  constructor(private readonly options: NullBillingProviderOptions) {}

  getPlan(restaurantId: string): Promise<Plan | null> {
    return this.options.loadPlan(restaurantId);
  }

  async listInvoices(_restaurantId: string): Promise<readonly BillingInvoice[]> {
    return [];
  }

  async recordUsage(event: UsageEvent): Promise<void> {
    await this.options.writeUsage?.(event);
  }
}

export class RecordingBillingProvider implements BillingProvider {
  readonly usage: UsageEvent[] = [];
  plans = new Map<string, Plan>();
  invoices: BillingInvoice[] = [];

  async getPlan(restaurantId: string): Promise<Plan | null> {
    return this.plans.get(restaurantId) ?? null;
  }

  async listInvoices(_restaurantId: string): Promise<readonly BillingInvoice[]> {
    return this.invoices;
  }

  async recordUsage(event: UsageEvent): Promise<void> {
    // (kind, refId) is unique in the database; mirror it so a retry never counts twice
    if (!this.usage.some((u) => u.kind === event.kind && u.refId === event.refId)) this.usage.push(event);
  }
}
