// apps/print-agent: prints order tickets on the restaurant's local printer (FR-254, ADR-038).
// Runs on the counter computer. Polls the API every MT_PRINT_POLL_MS; stops on SIGINT or SIGTERM.

import { runOnce } from "./agent";
import { loadConfig } from "./config";
import { CupsPrinter } from "./cups-printer";
import { HttpPrintJobApi } from "./http-api";
import { createLogger } from "./logger";

const config = loadConfig();
const log = createLogger(config.logLevel);
const deps = {
  api: new HttpPrintJobApi(config.apiUrl, config.apiKey),
  printer: new CupsPrinter(config.printer),
  log,
  columns: config.columns,
};

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

log.info("print agent started", { api_url: config.apiUrl, printer: config.printer, poll_ms: config.pollMs });
while (!stopping) {
  const handled = await runOnce(deps);
  // A full claim may leave more waiting: poll again at once.
  if (handled < 5) await Bun.sleep(config.pollMs);
}
log.info("print agent stopped");
