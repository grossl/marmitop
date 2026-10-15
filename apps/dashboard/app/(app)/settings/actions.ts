"use server";

import {
  connectWhatsApp,
  connectWhatsAppInput,
  createApiKey,
  createApiKeyInput,
  disableUatisWebhook,
  disconnectWhatsApp,
  enableUatisWebhook,
  getPlanAndUsage,
  getRestaurantProfile,
  getSettings,
  redeliverWebhook,
  revokeApiKey,
  rotateWebhookSecret,
  saveAutomaticMessage,
  saveBusinessHours,
  saveFiscalConfig,
  saveFiscalConfigInput,
  saveOrderPreferences,
  saveWebhookEndpoint,
  saveWebhookEndpointInput,
  testFiscalConnection,
  testWhatsAppConnection,
  updateRestaurantProfile,
} from "@mt/http";
import {
  revokeApiKeySchema,
  saveAutomaticMessageSchema,
  saveBusinessHoursSchema,
  saveOrderPreferencesSchema,
  saveProfileSchema,
} from "@mt/schemas";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { adminAction } from "@/lib/server/safe-action";

// Settings Server Actions (06.api-spec.md Appendix A, all `A` = admin only,
// FR-098). The first two are the P4a reference actions. Secrets: no action
// returns a stored secret. The only plaintext values that leave the server are
// the API key and the webhook signing secret at creation or rotation, shown
// once (FR-088, FR-089, ADR-009).

const none = z.undefined();
const refresh = () => revalidatePath("/settings");

async function saved<T>(work: Promise<T>): Promise<T> {
  const result = await work;
  refresh();
  return result;
}

export const getProfileAction = adminAction({ name: "settings.getProfile", input: none }, ({ deps, ctx }) =>
  getRestaurantProfile(deps, ctx, undefined),
);

export const saveProfileAction = adminAction(
  { name: "settings.saveProfile", input: saveProfileSchema },
  ({ deps, ctx, input }) => saved(updateRestaurantProfile(deps, ctx, input)),
);

export const getSettingsAction = adminAction({ name: "settings.get", input: none }, ({ deps, ctx }) =>
  getSettings(deps, ctx, undefined),
);

export const saveOrderPreferencesAction = adminAction(
  { name: "settings.saveOrderPreferences", input: saveOrderPreferencesSchema },
  ({ deps, ctx, input }) => saved(saveOrderPreferences(deps, ctx, input)),
);

export const saveBusinessHoursAction = adminAction(
  { name: "settings.saveBusinessHours", input: saveBusinessHoursSchema },
  ({ deps, ctx, input }) => saved(saveBusinessHours(deps, ctx, input)),
);

export const saveAutomaticMessageAction = adminAction(
  { name: "settings.saveAutomaticMessage", input: saveAutomaticMessageSchema },
  ({ deps, ctx, input }) => saved(saveAutomaticMessage(deps, ctx, input)),
);

export const connectWhatsAppAction = adminAction(
  { name: "settings.connectWhatsApp", input: connectWhatsAppInput },
  ({ deps, ctx, input }) => saved(connectWhatsApp(deps, ctx, input)),
);

export const testWhatsAppConnectionAction = adminAction(
  { name: "settings.testWhatsAppConnection", input: none },
  ({ deps, ctx }) => saved(testWhatsAppConnection(deps, ctx, undefined)),
);

export const disconnectWhatsAppAction = adminAction(
  { name: "settings.disconnectWhatsApp", input: none },
  ({ deps, ctx }) => saved(disconnectWhatsApp(deps, ctx, undefined)),
);

/** FR-170..FR-172 (ADR-021, ADR-023): push when MT_PUBLIC_URL is public, pull otherwise. */
export const enableUatisWebhookAction = adminAction(
  { name: "settings.enableUatisWebhook", input: none },
  ({ deps, ctx }) => saved(enableUatisWebhook(deps, ctx, undefined)),
);

/** FR-173. */
export const disableUatisWebhookAction = adminAction(
  { name: "settings.disableUatisWebhook", input: none },
  ({ deps, ctx }) => saved(disableUatisWebhook(deps, ctx, undefined)),
);

export const saveWebhookEndpointAction = adminAction(
  { name: "settings.saveWebhookEndpoint", input: saveWebhookEndpointInput },
  ({ deps, ctx, input }) => saved(saveWebhookEndpoint(deps, ctx, input)),
);

export const rotateWebhookSecretAction = adminAction(
  { name: "settings.rotateWebhookSecret", input: none },
  ({ deps, ctx }) => saved(rotateWebhookSecret(deps, ctx, undefined)),
);

/** FR-149: send a delivered or exhausted webhook delivery again. */
export const redeliverWebhookAction = adminAction(
  { name: "settings.redeliverWebhook", input: z.object({ deliveryId: z.string().uuid() }) },
  ({ deps, ctx, input }) => saved(redeliverWebhook(deps, ctx, input)),
);

export const createApiKeyAction = adminAction(
  { name: "settings.createApiKey", input: createApiKeyInput },
  ({ deps, ctx, input }) => saved(createApiKey(deps, ctx, input)),
);

export const revokeApiKeyAction = adminAction(
  { name: "settings.revokeApiKey", input: revokeApiKeySchema },
  ({ deps, ctx, input }) => saved(revokeApiKey(deps, ctx, input)),
);

export const saveFiscalConfigAction = adminAction(
  { name: "settings.saveFiscalConfig", input: saveFiscalConfigInput },
  ({ deps, ctx, input }) => saved(saveFiscalConfig(deps, ctx, input)),
);

export const testFiscalConnectionAction = adminAction(
  { name: "settings.testFiscalConnection", input: none },
  ({ deps, ctx }) => saved(testFiscalConnection(deps, ctx, undefined)),
);

export const getPlanAndUsageAction = adminAction({ name: "settings.getPlanAndUsage", input: none }, ({ deps, ctx }) =>
  getPlanAndUsage(deps, ctx, undefined),
);
