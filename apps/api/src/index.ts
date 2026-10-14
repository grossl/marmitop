// apps/api entry: reads the configuration, builds the service deps, serves on PORT (3101).
// A missing or forbidden variable stops the process with its name only (04.architecture.md
// "Configuration"); MT_ALLOW_PRIVATE_HOSTS with MT_ENV=production is refused (ADR-017 #5).

import { createDbUatisInboundStore, createServiceDeps, readServerConfig } from "@mt/http";

import { createApp } from "./app";
import { createApiLogger } from "./http/logger";

const log = createApiLogger(process.env.MT_LOG_LEVEL);
const result = readServerConfig();
if (!result.ok) {
  log.error("api cannot start: missing or invalid configuration", { variables: result.missing });
  process.exit(1);
}
const config = result.config;
if (config.allowPrivateHosts)
  log.warn("MT_ALLOW_PRIVATE_HOSTS=1: the SSRF guard allows private hosts (development only)");

const deps = createServiceDeps(config);
const app = createApp({ clock: deps.clock, log, uatisInbound: createDbUatisInboundStore(deps) });
const port = Number(process.env.PORT ?? 3101);

const server = Bun.serve({ port, fetch: app.fetch });
log.info("api listening", { port: server.port });

async function shutdown(signal: string) {
  log.info("api stopping", { signal });
  await server.stop();
  await deps.db.end({ timeout: 5 });
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
