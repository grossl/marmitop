"use server";

import { getReportPeriodDefault, getReports } from "@mt/http";
import { getReportsSchema } from "@mt/schemas";
import { z } from "zod";

import { adminAction } from "@/lib/server/safe-action";

// 06.api-spec.md Appendix A `getReports` (A). The screen reads through the
// Server Component; the action serves client-side refetch.

export const getReportsAction = adminAction({ name: "reports.get", input: getReportsSchema }, ({ deps, ctx, input }) =>
  getReports(deps, ctx, input),
);

export const getReportPeriodDefaultAction = adminAction(
  { name: "reports.periodDefault", input: z.undefined() },
  ({ deps, ctx }) => getReportPeriodDefault(deps, ctx, undefined),
);
