// @mt/core: domain logic and ports. Pure, zero I/O (04.architecture.md). Depends on nothing internal.
// Contract suites live at the subpath `@mt/core/contracts` because they import bun:test.

export const packageName = "@mt/core";

export * from "./ai";
export * from "./api-keys";
export * from "./automatic-messages";
export type { NullBillingProviderOptions } from "./billing/billing-providers";
export { NullBillingProvider, RecordingBillingProvider } from "./billing/billing-providers";
export * from "./br-documents";
export * from "./business-hours";
export * from "./errors";
export type { FakeWebhook, ManagementMethod, RecordedCall, ScriptedSend, SimulateInbound } from "./fakes/fake-gateway";
export { FakeGateway } from "./fakes/fake-gateway";
export type { InvoiceCall, ScriptedCreate } from "./fakes/fake-invoice-gateway";
export { FakeInvoiceGateway } from "./fakes/fake-invoice-gateway";
export type { RecordedDelivery, ScriptedWebhook } from "./fakes/fake-webhook-sender";
export { FakeWebhookSender } from "./fakes/fake-webhook-sender";
export { FixedClock } from "./fakes/fixed-clock";
export type { ScriptedStep } from "./fakes/scripted-assistant-model";
export { ScriptedAssistantModel } from "./fakes/scripted-assistant-model";
export * from "./fiscal";
export * from "./menu-order-message";
export * from "./money";
export * from "./order-status";
export * from "./order-total";
export * from "./ports";
export * from "./reports";
export * from "./retry-schedule";
export type { EnvelopeSecretBoxOptions, KekRef } from "./secret-box";
export { EnvelopeSecretBox, FakeSecretBox, parseKek } from "./secret-box";
export * from "./service-window";
export * from "./ssrf";
export * from "./uatis-mapping";
export * from "./webhook-signature";
