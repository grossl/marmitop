// packages/http/src/services/whatsapp/refresh.ts
//
// "Atualizar" in Conversas (FR-174, ADR-042). Marmitop never reads backend-uatis on a schedule;
// this is the only way to enqueue the timestamp poll (`mt_sync` `whatsapp_reconcile`, FR-107).
// `mt.request_whatsapp_refresh()` reads the restaurant from the RLS context that
// `defineService` sets, so a member can refresh only their own restaurant.

import { z } from "zod";

import { defineService } from "../../service";

export type RefreshWhatsAppResult = "enqueued" | "already_queued" | "not_connected";

export const refreshWhatsApp = defineService({
  name: "messages.refreshWhatsApp",
  minRole: "attendant",
  input: z.undefined(),
  run: async ({ tx }): Promise<{ readonly result: RefreshWhatsAppResult }> => {
    const [row] = await tx<{ result: RefreshWhatsAppResult }[]>`select mt.request_whatsapp_refresh() as result`;
    return { result: row?.result ?? "not_connected" };
  },
});

/** The pt-BR toast for each result (FR-174). */
export function refreshWhatsAppText(result: RefreshWhatsAppResult): string {
  if (result === "enqueued") return "Buscando mensagens no WhatsApp…";
  if (result === "already_queued") return "Uma atualização já está em andamento.";
  return "O WhatsApp não está conectado.";
}
