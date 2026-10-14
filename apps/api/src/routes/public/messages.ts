// POST /v1/messages (06.api-spec.md "Messages"; FR-014, FR-117; ADR-014).

import type { PublicApiBackend } from "@mt/http";
import { sendMessageBodySchema } from "@mt/schemas";
import type { Hono } from "hono";

import type { ApiDeps } from "../../http/types";
import { handle, type PublicEnv, readBody } from "./middleware";

export function messageRoutes(app: Hono<PublicEnv>, deps: ApiDeps, { ops }: PublicApiBackend): Hono<PublicEnv> {
  return app.post(
    "/",
    handle(deps, async (c) =>
      c.json(await ops.sendMessage(c.get("apiKey"), await readBody(c, sendMessageBodySchema)), 201),
    ),
  );
}
