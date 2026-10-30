// The agent's environment (apps/print-agent/.env.example; 11.operations.md "Order ticket printer").

import { homedir } from "node:os";
import { join } from "node:path";

import { TICKET_COLUMNS } from "@mt/core";

export interface AgentConfig {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly printer: string;
  readonly pollMs: number;
  readonly columns: number;
  readonly logLevel: string;
  /** The printed-jobs record (FR-254). */
  readonly statePath: string;
}

function intOr(value: string | undefined, fallback: number, min: number): number {
  const n = Number(value);
  return value && Number.isInteger(n) && n >= min ? n : fallback;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AgentConfig {
  const missing = ["MT_API_URL", "MT_API_KEY", "MT_PRINTER"].filter((k) => !env[k]?.trim());
  if (missing.length > 0) throw new Error(`Missing ${missing.join(", ")}. See apps/print-agent/.env.example.`);
  if (!/^mtk_(live|test)_/.test(env.MT_API_KEY ?? "")) throw new Error("MT_API_KEY is not a Marmitop API key.");
  return {
    apiUrl: env.MT_API_URL?.trim() ?? "",
    apiKey: env.MT_API_KEY?.trim() ?? "",
    printer: env.MT_PRINTER?.trim() ?? "",
    pollMs: intOr(env.MT_PRINT_POLL_MS, 3000, 500),
    columns: intOr(env.MT_PRINT_COLUMNS, TICKET_COLUMNS, 24),
    logLevel: env.MT_LOG_LEVEL ?? "info",
    statePath: env.MT_PRINT_STATE?.trim() || join(homedir(), ".marmitop", "printed-jobs.json"),
  };
}
