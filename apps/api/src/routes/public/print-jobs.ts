// /v1/print-jobs (06.api-spec.md "Print jobs"; FR-251, FR-252, ADR-038). The local print agent calls these.

import type { PublicApiBackend } from "@mt/http";
import { claimPrintJobsBodySchema, printJobResultBodySchema } from "@mt/schemas";
import type { Hono } from "hono";

import type { ApiDeps } from "../../http/types";
import { handle, type PublicEnv, readBody } from "./middleware";

export function printJobRoutes(app: Hono<PublicEnv>, deps: ApiDeps, { ops }: PublicApiBackend): Hono<PublicEnv> {
  return app
    .post(
      "/claim",
      handle(deps, async (c) =>
        c.json(await ops.claimPrintJobs(c.get("apiKey"), await readBody(c, claimPrintJobsBodySchema))),
      ),
    )
    .post(
      "/:id/result",
      handle(deps, async (c) =>
        c.json(
          await ops.reportPrintJobResult(
            c.get("apiKey"),
            c.req.param("id") ?? "",
            await readBody(c, printJobResultBodySchema),
          ),
        ),
      ),
    );
}
