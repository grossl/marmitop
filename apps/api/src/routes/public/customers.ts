// /v1/customers (06.api-spec.md "Customers"; FR-142).

import type { PublicApiBackend } from "@mt/http";
import { createCustomerBodySchema, listCustomersQuerySchema, updateCustomerBodySchema } from "@mt/schemas";
import type { Hono } from "hono";

import type { ApiDeps } from "../../http/types";
import { handle, type PublicEnv, readBody, readQuery } from "./middleware";

export function customerRoutes(app: Hono<PublicEnv>, deps: ApiDeps, { ops }: PublicApiBackend): Hono<PublicEnv> {
  return app
    .get(
      "/",
      handle(deps, async (c) =>
        c.json(await ops.listCustomers(c.get("apiKey"), readQuery(c, listCustomersQuerySchema))),
      ),
    )
    .post(
      "/",
      handle(deps, async (c) =>
        c.json(await ops.createCustomer(c.get("apiKey"), await readBody(c, createCustomerBodySchema)), 201),
      ),
    )
    .get(
      "/:id",
      handle(deps, async (c) => c.json(await ops.getCustomer(c.get("apiKey"), c.req.param("id") ?? ""))),
    )
    .patch(
      "/:id",
      handle(deps, async (c) =>
        c.json(
          await ops.updateCustomer(
            c.get("apiKey"),
            c.req.param("id") ?? "",
            await readBody(c, updateCustomerBodySchema),
          ),
        ),
      ),
    );
}
