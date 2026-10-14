// covers NFR-031 (worker health endpoint)
import { expect, test } from "bun:test";

import { healthResponse } from "./health";

const base = { queues: [], inFlight: 0, processed: 0, failed: 0, lastTickAt: null };

test("health is 200 while the worker runs", async () => {
  const res = healthResponse({ ...base, status: "ok" });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ status: "ok" });
});

test("health is 503 while the worker stops", () => {
  expect(healthResponse({ ...base, status: "stopping" }).status).toBe(503);
});
