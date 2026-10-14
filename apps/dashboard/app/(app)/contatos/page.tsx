import type { Metadata } from "next";

import { ContactsPage } from "@/components/contacts-page";
import { requireScreen } from "@/lib/server/session";

export const metadata: Metadata = { title: "Contatos — Marmitop" };

// Role gate on the server (FR-005): a screen the role cannot open is a 404.
export default async function ContatosRoute() {
  await requireScreen("contatos");
  return (
    <div className="flex-1 overflow-hidden">
      <ContactsPage />
    </div>
  );
}
