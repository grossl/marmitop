// /v1/menu, read-only in v1 (06.api-spec.md "Menu"; FR-142).

import type { PublicApiBackend } from "@mt/http";
import { listMenuQuerySchema } from "@mt/schemas";
import type { Hono } from "hono";

import type { ApiDeps } from "../../http/types";
import { handle, type PublicEnv, readQuery } from "./middleware";

export function menuRoutes(app: Hono<PublicEnv>, deps: ApiDeps, { ops }: PublicApiBackend): Hono<PublicEnv> {
  return app.get(
    "/",
    handle(deps, async (c) => c.json(await ops.listMenu(c.get("apiKey"), readQuery(c, listMenuQuerySchema)))),
  );
}
