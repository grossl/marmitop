// /v1/orders (06.api-spec.md "Orders"; FR-142).

import type { PublicApiBackend } from "@mt/http";
import { createOrderBodySchema, listOrdersQuerySchema, patchOrderBodySchema } from "@mt/schemas";
import type { Hono } from "hono";

import type { ApiDeps } from "../../http/types";
import { handle, type PublicEnv, readBody, readQuery } from "./middleware";

export function orderRoutes(app: Hono<PublicEnv>, deps: ApiDeps, { ops }: PublicApiBackend): Hono<PublicEnv> {
  return app
    .get(
      "/",
      handle(deps, async (c) => c.json(await ops.listOrders(c.get("apiKey"), readQuery(c, listOrdersQuerySchema)))),
    )
    .post(
      "/",
      handle(deps, async (c) =>
        c.json(await ops.createOrder(c.get("apiKey"), await readBody(c, createOrderBodySchema)), 201),
      ),
    )
    .get(
      "/:id",
      handle(deps, async (c) => c.json(await ops.getOrder(c.get("apiKey"), c.req.param("id") ?? ""))),
    )
    .patch(
      "/:id",
      handle(deps, async (c) =>
        c.json(
          await ops.changeOrderStatus(
            c.get("apiKey"),
            c.req.param("id") ?? "",
            await readBody(c, patchOrderBodySchema),
          ),
        ),
      ),
    );
}
