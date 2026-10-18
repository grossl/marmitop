// apps/worker entry: pgmq consumer (ADR-007) plus GET /health on WORKER_HEALTH_PORT (8181).
// SIGTERM and SIGINT stop reading, wait for running jobs, then close the pool.

import { ScriptedAssistantModel } from "@mt/core";
import { withoutContext } from "@mt/db";
import { createServiceDeps, readServerConfig } from "@mt/http";

import { AnthropicAssistantModel } from "./ai/anthropic-model";
import { readAiConfig } from "./ai/config";
import { FeedPullTimer } from "./feed-timer";
import { createLogger } from "./framework/logger";
import { PgmqQueueClient } from "./framework/pgmq-client";
import { QueueWorker } from "./framework/worker";
import { healthResponse } from "./health";
import { buildRegistry } from "./registry";

const log = createLogger(process.env.MT_LOG_LEVEL);
const result = readServerConfig();
if (!result.ok) {
  log.error("worker cannot start: missing or invalid configuration", { variables: result.missing });
  process.exit(1);
}
const config = result.config;
if (config.allowPrivateHosts)
  log.warn("MT_ALLOW_PRIVATE_HOSTS=1: the SSRF guard allows private hosts (development only)");
if (config.uatisFake) {
  log.warn("MT_UATIS_FAKE=1: sends go to an in-process FakeGateway, not backend-uatis");
}

const deps = createServiceDeps(config);
// FR-198: the AI assistant model. Never log ai.apiKey.
const ai = readAiConfig();
const model =
  ai.apiKey === null
    ? new ScriptedAssistantModel([])
    : AnthropicAssistantModel.fromConfig({ ...ai, apiKey: ai.apiKey });
if (ai.apiKey === null) log.warn("AI assistant in fake mode: ANTHROPIC_API_KEY is empty, AI turns will fail", {});
else log.info("AI assistant ready", { model: ai.model, effort: ai.effort });
const worker = new QueueWorker({
  client: new PgmqQueueClient(deps.db, deps.contextOptions),
  registry: buildRegistry(deps, log, model),
  log,
  concurrency: Number(process.env.MT_WORKER_CONCURRENCY ?? 4),
});

const port = Number(process.env.WORKER_HEALTH_PORT ?? 8181);
const server = Bun.serve({
  port,
  fetch: (req) =>
    new URL(req.url).pathname === "/health"
      ? healthResponse(worker.health())
      : new Response("not found", { status: 404 }),
});
// ADR-023, FR-174: enqueue event-feed reads every MT_UATIS_PULL_SECONDS.
const feedTimer = new FeedPullTimer({
  pullSeconds: config.uatisPullSeconds,
  enqueue: (seconds) =>
    withoutContext(deps.db, async (tx) => {
      const [row] = await tx<{ n: number }[]>`select mt.enqueue_uatis_feed_pulls(${seconds}::int) as n`;
      return row?.n ?? 0;
    }),
  log,
});
worker.start();
feedTimer.start();
log.info("worker health listening", { port: server.port, uatisPullSeconds: config.uatisPullSeconds });

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info("worker stopping", { signal });
  await feedTimer.stop();
  await worker.stop();
  await server.stop();
  await deps.db.end({ timeout: 5 });
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
