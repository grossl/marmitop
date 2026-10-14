import { getCustomer, listCustomers } from "@mt/http";
import { searchTermSchema, uuidSchema } from "@mt/schemas";
import type { Metadata } from "next";

import { ContactsPage } from "@/components/contacts-page";
import { requireDeps } from "@/lib/server/deps";
import { requireScreen } from "@/lib/server/session";

export const metadata: Metadata = { title: "Contatos — Marmitop" };

// Role gate on the server (FR-005): a screen the role cannot open is a 404.
// `?q=` searches name, phone, or bairro (FR-041); `?id=` opens the sheet (FR-042).
export default async function ContatosRoute({ searchParams }: { searchParams: Promise<{ q?: string; id?: string }> }) {
  const ctx = await requireScreen("contatos");
  const deps = requireDeps();
  const params = await searchParams;
  const q = searchTermSchema.safeParse(params.q ?? "");
  const term = q.success ? q.data : "";

  const list = await listCustomers(deps, ctx, { q: term || undefined, limit: 100 });
  const selected =
    params.id && uuidSchema.safeParse(params.id).success
      ? await getCustomer(deps, ctx, { customerId: params.id }).catch(() => null)
      : null;

  return (
    <div className="flex-1 overflow-hidden">
      <ContactsPage query={term} customers={list.items} hasMore={list.nextCursor !== null} selected={selected} />
    </div>
  );
}
