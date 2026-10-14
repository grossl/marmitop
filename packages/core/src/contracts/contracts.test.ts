// covers FR-100, FR-124, FR-147, FR-150, FR-151, FR-156, NFR-010, NFR-061
import { randomBytes } from "node:crypto";
import { NullBillingProvider, RecordingBillingProvider } from "../billing/billing-providers";
import { FakeGateway } from "../fakes/fake-gateway";
import { FakeInvoiceGateway } from "../fakes/fake-invoice-gateway";
import { FakeWebhookSender } from "../fakes/fake-webhook-sender";
import { FixedClock } from "../fakes/fixed-clock";
import type { Plan } from "../ports/billing-provider";
import { systemClock } from "../ports/clock";
import { EnvelopeSecretBox, FakeSecretBox } from "../secret-box";
import { billingProviderContract } from "./billing-provider.contract";
import { clockContract } from "./clock.contract";
import { invoiceGatewayContract } from "./invoice-gateway.contract";
import { secretBoxContract } from "./secret-box.contract";
import { webhookSenderContract } from "./webhook-sender.contract";
import { whatsappGatewayContract } from "./whatsapp-gateway.contract";

whatsappGatewayContract("FakeGateway", async () => {
  const gateway = new FakeGateway();
  return { gateway, injectInbound: async (from, body) => void gateway.simulateInbound({ from, body }) };
});

invoiceGatewayContract("FakeInvoiceGateway", async () => ({ gateway: new FakeInvoiceGateway() }));

const plan: Plan = {
  code: "free",
  name: "Gratuito",
  includedOrdersMonth: 100,
  includedMessagesMonth: 500,
  includedInvoicesMonth: 50,
  priceDisplay: "R$ 0",
};
billingProviderContract("NullBillingProvider", async () => ({
  provider: new NullBillingProvider({ loadPlan: async () => plan }),
  restaurantId: "r1",
}));
billingProviderContract("RecordingBillingProvider", async () => {
  const provider = new RecordingBillingProvider();
  provider.plans.set("r1", plan);
  return { provider, restaurantId: "r1" };
});

secretBoxContract("EnvelopeSecretBox", () => new EnvelopeSecretBox({ kek: new Uint8Array(randomBytes(32)) }));
secretBoxContract("FakeSecretBox", () => new FakeSecretBox());

clockContract("systemClock", () => systemClock);
clockContract("FixedClock", () => new FixedClock("2026-10-13T12:00:00Z"));

webhookSenderContract("FakeWebhookSender", async () => ({
  sender: new FakeWebhookSender(),
  url: "https://hooks.example.com/x",
}));
