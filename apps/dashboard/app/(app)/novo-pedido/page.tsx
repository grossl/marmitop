import { getOrderFormData, lookupCustomers } from "@mt/http";
import { uuidSchema } from "@mt/schemas";
import type { Metadata } from "next";

import { ManualOrderPage } from "@/components/manual-order-page";
import { requireDeps } from "@/lib/server/deps";
import { requireScreen } from "@/lib/server/session";

export const metadata: Metadata = { title: "Novo pedido — Marmitop" };
export const dynamic = "force-dynamic";

const asUuid = (v: string | undefined) => (v !== undefined && uuidSchema.safeParse(v).success ? v : null);

// Role gate on the server (FR-005): a screen the role cannot open is a 404.
// The messaging screen links here with `?conversation=<id>&customer=<id>` (FR-030..FR-039).
export default async function NovoPedidoRoute({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string; customer?: string }>;
}) {
  const ctx = await requireScreen("novo-pedido");
  const params = await searchParams;
  const conversationId = asUuid(params.conversation);
  const customerId = asUuid(params.customer);
  const deps = requireDeps();
  const [form, customers] = await Promise.all([
    getOrderFormData(deps, ctx, undefined),
    lookupCustomers(deps, ctx, { ids: customerId ? [customerId] : [] }),
  ]);
  return (
    <div className="flex-1 overflow-hidden">
      <ManualOrderPage
        form={form}
        initialCustomers={customers}
        initialCustomerId={customerId && customers.some((c) => c.id === customerId) ? customerId : null}
        conversationId={conversationId}
      />
    </div>
  );
}
