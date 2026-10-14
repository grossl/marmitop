import { getReportPeriodDefault, getReports } from "@mt/http";
import { getReportsSchema } from "@mt/schemas";
import type { Metadata } from "next";

import { ReportsPage } from "@/components/reports-page";
import { requireDeps } from "@/lib/server/deps";
import { requireScreen } from "@/lib/server/session";

export const metadata: Metadata = { title: "Relatórios — Marmitop" };

type SearchParams = Promise<{ from?: string | string[]; to?: string | string[] }>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Role gate on the server (FR-005, FR-079): a screen the role cannot open is a 404.
// The period lives in the URL (`?from=&to=`), so it survives reloads and links.
export default async function RelatoriosRoute({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireScreen("relatorios");
  const deps = requireDeps();
  const params = await searchParams;
  const defaults = await getReportPeriodDefault(deps, ctx, undefined);

  const requested = getReportsSchema.safeParse({
    from: first(params.from) ?? defaults.from,
    to: first(params.to) ?? defaults.to,
  });
  const period = requested.success ? requested.data : { from: defaults.from, to: defaults.to };
  const periodError = requested.success ? null : (requested.error.issues[0]?.message ?? "Período inválido.");
  const report = await getReports(deps, ctx, period);

  return (
    <div className="flex-1 overflow-hidden">
      <ReportsPage report={report} today={defaults.today} periodError={periodError} />
    </div>
  );
}
