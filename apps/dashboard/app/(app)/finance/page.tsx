import { getFinanceTotals, listPaidOrders, lookupCustomers } from "@mt/http";
import { FINANCE_INVOICE_STATES, type FinanceInvoiceState, listPaidOrdersSchema } from "@mt/schemas";
import type { Metadata } from "next";

import { FinancePage } from "@/components/finance-page";
import { requireDeps } from "@/lib/server/deps";
import { requireScreen } from "@/lib/server/session";

export const metadata: Metadata = { title: "Financeiro — Marmitop" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Role gate on the server (FR-169, FR-005): an attendant gets a 404.
// The filters live in the URL (`?from=&to=&customer=&invoice=`), so they survive reloads and links.
export default async function FinanceRoute({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireScreen("finance");
  const deps = requireDeps();
  const params = await searchParams;

  const invoiceParam = first(params.invoice);
  const requested = listPaidOrdersSchema.safeParse({
    from: first(params.from) || undefined,
    to: first(params.to) || undefined,
    customerId: first(params.customer) || undefined,
    invoiceState: FINANCE_INVOICE_STATES.includes(invoiceParam as FinanceInvoiceState) ? invoiceParam : "all",
  });
  const filter = requested.success ? requested.data : { invoiceState: "all" as const };
  const filterError = requested.success ? null : (requested.error.issues[0]?.message ?? "Filtro inválido.");

  const [page, totals, pinned] = await Promise.all([
    listPaidOrders(deps, ctx, filter),
    getFinanceTotals(deps, ctx, filter),
    filter.customerId ? lookupCustomers(deps, ctx, { ids: [filter.customerId] }) : Promise.resolve([]),
  ]);
  const customer = pinned.find((c) => c.id === filter.customerId) ?? null;

  return (
    <div className="flex-1 overflow-hidden">
      <FinancePage
        // A new filter remounts the client state (selection, extra pages).
        key={JSON.stringify(filter)}
        restaurantId={ctx.restaurantId}
        initialPage={page}
        totals={totals}
        invoiceState={filter.invoiceState}
        customer={customer ? { id: customer.id, name: customer.name, phone: customer.phone } : null}
        filterError={filterError}
      />
    </div>
  );
}
