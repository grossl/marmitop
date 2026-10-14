// Report requests (Appendix A `getReports`, FR-070..FR-079).

import { z } from "zod";

function parseDay(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? t : null;
}

const day = z.string().refine((v) => parseDay(v) !== null, "Use uma data válida (AAAA-MM-DD).");

/** Inclusive local days in the restaurant timezone, at most 366 days apart. */
export const getReportsSchema = z.object({ from: day, to: day }).superRefine((v, ctx) => {
  const from = parseDay(v.from);
  const to = parseDay(v.to);
  if (from === null || to === null) return;
  if (to < from)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "A data final vem antes da inicial." });
  else if ((to - from) / 86_400_000 > 365) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "O período máximo é de 366 dias." });
  }
});
