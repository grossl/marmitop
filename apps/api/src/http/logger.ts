// One JSON line per event (11.operations.md). Never logs secrets, keys, or bodies (NFR-011).

import type { ApiLogger } from "./types";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

export function createApiLogger(level = "info"): ApiLogger {
  const min = LEVELS[(level in LEVELS ? level : "info") as keyof typeof LEVELS];
  const emit = (lvl: keyof typeof LEVELS, msg: string, fields: Record<string, unknown> = {}) => {
    if (LEVELS[lvl] < min) return;
    const line = JSON.stringify({ t: new Date().toISOString(), level: lvl, service: "api", msg, ...fields });
    if (lvl === "error" || lvl === "warn") console.error(line);
    else console.log(line);
  };
  return {
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
}
