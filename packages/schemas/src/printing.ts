// Print job bodies for the local print agent (06.api-spec.md "Print jobs"; FR-251, FR-252, ADR-038).

import { z } from "zod";

/** `POST /v1/print-jobs/claim`. */
export const claimPrintJobsBodySchema = z
  .object({ limit: z.number().int().min(1).max(10).default(5) })
  .strict();

/** `POST /v1/print-jobs/{id}/result`. */
export const printJobResultBodySchema = z
  .object({ printed: z.boolean(), error: z.string().max(500).optional() })
  .strict();
