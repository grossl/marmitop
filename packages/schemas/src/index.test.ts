// covers FR-144
import { describe, expect, test } from "bun:test";
import * as pkg from "./index";

describe("@mt/schemas public surface", () => {
  test("exports a schema for every request in 06.api-spec.md and the Appendix A actions", () => {
    for (const name of [
      "createOrderBodySchema",
      "patchOrderBodySchema",
      "listOrdersQuerySchema",
      "createCustomerBodySchema",
      "updateCustomerBodySchema",
      "listCustomersQuerySchema",
      "listMenuQuerySchema",
      "sendMessageBodySchema",
      "createOrderActionSchema",
      "changeOrderStatusActionSchema",
      "createCustomerActionSchema",
      "updateCustomerActionSchema",
      "saveMenuItemSchema",
      "saveStockItemSchema",
      "recordStockMovementSchema",
      "saveProfileSchema",
      "saveOrderPreferencesSchema",
      "saveBusinessHoursSchema",
      "saveAutomaticMessageSchema",
      "makeConnectWhatsAppSchema",
      "makeSaveWebhookEndpointSchema",
      "makeSaveFiscalConfigSchema",
      "createApiKeySchema",
      "issueInvoiceSchema",
      "cancelInvoiceSchema",
      "getReportsSchema",
      "apiErrorSchema",
      "outboundMessageJobSchema",
      "invoiceJobSchema",
      "cpfCnpjSchema",
      "aiTurnJobSchema",
      "saveAiSettingsSchema",
      "setConversationAiModeSchema",
      "searchMenuInputSchema",
      "updateCartInputSchema",
      "handoffInputSchema",
      "emptyToolInputSchema",
      "cepSchema",
      "ufSchema",
    ]) {
      expect((pkg as Record<string, unknown>)[name], name).toBeDefined();
    }
  });
});
