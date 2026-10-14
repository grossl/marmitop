// One JSON line per event on stdout (11.operations.md). Fields never carry
// secrets, API keys, or message bodies (NFR-011).

import type { Logger } from "./types";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

export function createLogger(level: string = "info", service = "worker"): Logger {
  const min = LEVELS[(level in LEVELS ? level : "info") as Level];
  const emit = (lvl: Level, message: string, fields: Record<string, unknown> = {}) => {
    if (LEVELS[lvl] < min) return;
    const line = JSON.stringify({ t: new Date().toISOString(), level: lvl, service, msg: message, ...fields });
    if (lvl === "error" || lvl === "warn") console.error(line);
    else console.log(line);
  };
  return {
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
}
