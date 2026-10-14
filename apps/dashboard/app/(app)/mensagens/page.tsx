import type { Metadata } from "next";

import { MessagesScreen } from "@/components/messages-screen";
import { requireScreen } from "@/lib/server/session";

export const metadata: Metadata = { title: "Mensagens — Marmitop" };

// Role gate on the server (FR-005): a screen the role cannot open is a 404.
export default async function MensagensRoute() {
  await requireScreen("mensagens");
  return <MessagesScreen />;
}
