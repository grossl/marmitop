// GET /health on WORKER_HEALTH_PORT (8181): 200 while the loop runs, 503 while it stops (11.operations.md).

import type { WorkerHealth } from "./framework/worker";

export function healthResponse(health: WorkerHealth): Response {
  return Response.json(health, { status: health.status === "ok" ? 200 : 503 });
}
