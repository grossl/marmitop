// Contract suite for BillingProvider (ADR-008, FR-150, FR-151, FR-156).

import { describe, expect, test } from "bun:test";
import type { BillingProvider } from "../ports/billing-provider";

export function billingProviderContract(
  name: string,
  create: () => Promise<{ provider: BillingProvider; restaurantId: string }>,
): void {
  describe(`BillingProvider contract: ${name}`, () => {
    test("getPlan returns a plan with numeric limits for a known restaurant", async () => {
      const { provider, restaurantId } = await create();
      const plan = await provider.getPlan(restaurantId);
      expect(plan).not.toBeNull();
      expect(typeof plan?.code).toBe("string");
      expect(typeof plan?.includedOrdersMonth).toBe("number");
      expect(typeof plan?.includedMessagesMonth).toBe("number");
      expect(typeof plan?.includedInvoicesMonth).toBe("number");
    });

    test("listInvoices returns an array", async () => {
      const { provider, restaurantId } = await create();
      expect(Array.isArray(await provider.listInvoices(restaurantId))).toBe(true);
    });

    test("recordUsage accepts every usage kind and resolves", async () => {
      const { provider, restaurantId } = await create();
      for (const kind of ["order.created", "message.sent", "invoice.issued"] as const) {
        await expect(
          provider.recordUsage({
            restaurantId,
            kind,
            refId: `ref-${kind}`,
            occurredAt: new Date("2026-10-13T12:00:00Z"),
          }),
        ).resolves.toBeUndefined();
      }
    });
  });
}
