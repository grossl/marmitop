#!/usr/bin/env bun
// scripts/local-dev.ts
//
// One command for the local stack (11.operations.md "Local development").
// The Supabase CLI owns Postgres, Auth, Storage and Realtime and applies
// supabase/migrations plus supabase/seed.sql. This script starts it, writes
// each app's env file, and proves the result works.
//
//   bun scripts/local-dev.ts up      start the stack if needed, reset the database,
//                                    write env files, verify, print a summary
//   bun scripts/local-dev.ts reset   the same on a running stack, without starting it
//   bun scripts/local-dev.ts env     write env files only
//   bun scripts/local-dev.ts down    supabase stop
//
// Root scripts: `bun run dev:stack`, `bun run db:reset`, `bun run dev:stack:down`.
// Values that change per stack (URL, anon key, JWT secret, JWKS) come from
// `supabase status -o json` and the running Auth service. Fixed dev values
// (MT_KEK, the app_service password, logins) come from scripts/dev-seed/constants.ts.
// Dependency-free: Bun and Node built-ins only.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  API_KEYS,
  DEV_API_PUBLIC_URL,
  DEV_DASHBOARD_URL,
  DEV_DB_HOST_PORT,
  DEV_DB_URL,
  DEV_KEK_BASE64,
  DEV_MAILPIT_URL,
  DEV_STUDIO_URL,
  DEV_USER_PASSWORD,
  USER_LIST,
} from "./dev-seed/constants";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts", "dev-seed", "verify.ts");

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runCaptured(cmd: string[]): RunResult {
  try {
    const proc = Bun.spawnSync(cmd, { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
    return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
  } catch (error) {
    return { stdout: "", stderr: error instanceof Error ? error.message : String(error), exitCode: 127 };
  }
}

function runInherited(cmd: string[], env?: Record<string, string>): number {
  try {
    const proc = Bun.spawnSync(cmd, {
      cwd: REPO_ROOT,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
      env: { ...process.env, ...env },
    });
    return proc.exitCode ?? 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 127;
  }
}

function fail(message: string, detail?: string): never {
  console.error(message);
  if (detail?.trim()) console.error(detail.trim());
  process.exit(1);
}

// ---------------------------------------------------------------------------
// supabase status -> env values (pure)
// ---------------------------------------------------------------------------

export interface StackEnv {
  readonly apiUrl: string;
  readonly anonKey: string;
  readonly jwtSecret: string;
}

/** Reads the three values every env file needs. Matches keys case-insensitively, with or without `SUPABASE_`. */
export function extractStackEnv(status: Record<string, unknown>): StackEnv {
  const find = (...names: string[]) => {
    for (const [key, value] of Object.entries(status)) {
      const k = key.toUpperCase().replace(/^SUPABASE_/, "");
      if (names.includes(k) && typeof value === "string" && value !== "") return value;
    }
    return undefined;
  };
  const apiUrl = find("API_URL");
  const anonKey = find("ANON_KEY", "PUBLISHABLE_KEY");
  const jwtSecret = find("JWT_SECRET");
  const missing = [apiUrl ? null : "API_URL", anonKey ? null : "ANON_KEY", jwtSecret ? null : "JWT_SECRET"].filter(
    (x) => x !== null,
  );
  if (missing.length > 0 || !apiUrl || !anonKey || !jwtSecret) {
    throw new Error(`supabase status did not include ${missing.join(", ")}. Keys: ${Object.keys(status).join(", ")}`);
  }
  return { apiUrl, anonKey, jwtSecret };
}

export const ENV_FILE_MARKER =
  "# written by scripts/local-dev.ts. Do not commit. Rerun `bun run dev:stack` to refresh.";

export interface EnvFileSpec {
  readonly relPath: string;
  readonly lines: readonly string[];
}

/** Variable names follow 04.architecture.md "Configuration". */
export function buildEnvFiles(env: StackEnv, jwks: string): readonly EnvFileSpec[] {
  const shared = [
    `DATABASE_URL=${DEV_DB_URL}`,
    `MT_KEK=${DEV_KEK_BASE64}`,
    `SUPABASE_URL=${env.apiUrl}`,
    "MT_ENV=development",
    "MT_LOG_LEVEL=info",
    // ADR-024: the apps talk to the real local backend-uatis and web-nf. Set 1 to
    // fall back to the in-process fakes (ADR-017).
    "MT_UATIS_FAKE=0",
    "MT_WEBNF_FAKE=0",
    // The sibling stacks listen on http://127.0.0.1, which the SSRF guard blocks otherwise.
    "MT_ALLOW_PRIVATE_HOSTS=1",
  ];
  const jwt = [
    `SUPABASE_JWT_SECRET=${env.jwtSecret}`,
    // Single-quoted: the value is JSON.
    `SUPABASE_JWT_JWKS='${jwks}'`,
  ];
  return [
    {
      relPath: join("apps", "dashboard", ".env.local"),
      lines: [
        `NEXT_PUBLIC_SUPABASE_URL=${env.apiUrl}`,
        `NEXT_PUBLIC_SUPABASE_ANON_KEY=${env.anonKey}`,
        ...shared,
        ...jwt,
        `MT_PUBLIC_URL=${DEV_API_PUBLIC_URL}`,
        "PORT=3100",
      ],
    },
    {
      relPath: join("apps", "api", ".env"),
      lines: [...shared, ...jwt, `MT_PUBLIC_URL=${DEV_API_PUBLIC_URL}`, "PORT=3101"],
    },
    {
      relPath: join("apps", "worker", ".env"),
      lines: [...shared, "MT_WORKER_CONCURRENCY=4", "WORKER_HEALTH_PORT=8181"],
    },
  ];
}

export function renderEnvFile(spec: EnvFileSpec): string {
  return `${ENV_FILE_MARKER}\n${spec.lines.join("\n")}\n`;
}

/** Moves a hand-written env file aside (never overwriting an earlier backup), then writes ours. */
function writeEnvFile(spec: EnvFileSpec): void {
  const path = join(REPO_ROOT, spec.relPath);
  if (existsSync(path) && !readFileSync(path, "utf8").startsWith(ENV_FILE_MARKER)) {
    let backup = `${path}.bak`;
    for (let n = 2; existsSync(backup); n += 1) backup = `${path}.bak.${n}`;
    renameSync(path, backup);
    console.log(`  ${spec.relPath} was hand-written: moved to ${relative(REPO_ROOT, backup)}`);
  }
  writeFileSync(path, renderEnvFile(spec), "utf8");
  console.log(`  wrote ${spec.relPath}`);
}

function stackStatus(): Record<string, unknown> {
  const r = runCaptured(["supabase", "status", "-o", "json"]);
  if (r.exitCode !== 0)
    fail("could not read `supabase status -o json`. Is the stack running? Run `bun run dev:stack`.", r.stderr);
  try {
    return JSON.parse(r.stdout) as Record<string, unknown>;
  } catch {
    fail("`supabase status -o json` did not print JSON:", r.stdout);
  }
}

/**
 * The local Auth service signs sessions with an ES256 key, not with the
 * reported JWT secret, so apps/api needs the public JWKS (11.operations.md
 * "Session tokens"). A missing JWKS fails the bootstrap.
 */
async function fetchJwks(apiUrl: string): Promise<string> {
  const url = `${apiUrl.replace(/\/+$/, "")}/auth/v1/.well-known/jwks.json`;
  let parsed: unknown;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    parsed = await res.json();
  } catch (error) {
    fail(`could not fetch the local JWKS from ${url}`, error instanceof Error ? error.message : String(error));
  }
  const keys = (parsed as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(keys) || keys.length === 0) fail(`${url} returned no signing keys`);
  return JSON.stringify(parsed);
}

async function writeAllEnvFiles(): Promise<void> {
  const env = extractStackEnv(stackStatus());
  const jwks = await fetchJwks(env.apiUrl);
  console.log("writing env files...");
  for (const spec of buildEnvFiles(env, jwks)) writeEnvFile(spec);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function ensureCli(): void {
  const r = runCaptured(["supabase", "--version"]);
  if (r.exitCode !== 0) fail("supabase CLI not found. Install it: brew install supabase/tap/supabase", r.stderr);
}

function isRunning(): boolean {
  return runCaptured(["supabase", "status"]).exitCode === 0;
}

function dbReset(): void {
  console.log("resetting the database (supabase db reset)...");
  if (runInherited(["supabase", "db", "reset"]) !== 0) fail("supabase db reset failed (see above).");
}

function verify(): void {
  console.log("verifying the seed (scripts/dev-seed/verify.ts)...");
  if (runInherited(["bun", VERIFY_SCRIPT]) !== 0) fail("seed verification failed (see above).");
}

function summary(): void {
  console.log(
    [
      "",
      "Local stack ready.",
      "",
      "Services:",
      "  Supabase API  http://127.0.0.1:54421",
      `  Postgres      ${DEV_DB_HOST_PORT}`,
      `  Studio        ${DEV_STUDIO_URL}`,
      `  Mailpit       ${DEV_MAILPIT_URL}`,
      `  Dashboard     ${DEV_DASHBOARD_URL} (bun run --cwd apps/dashboard dev)`,
      `  API           ${DEV_API_PUBLIC_URL} (bun run --cwd apps/api dev)`,
      "  Worker        health on :8181 (bun run --cwd apps/worker dev)",
      "",
      `Logins (password ${DEV_USER_PASSWORD}):`,
      ...USER_LIST.map((u) => `  ${u.email.padEnd(30)} ${u.role.padEnd(9)} ${u.restaurant.name}`),
      "",
      "API keys:",
      ...API_KEYS.map((k) => `  ${k.restaurant.name.padEnd(16)} ${k.plaintext}${k.revoked ? " (revoked)" : ""}`),
      "",
      "Integration tests use a separate database (mt_test) on the same cluster: bun run test",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  switch (process.argv[2]) {
    case "up":
      ensureCli();
      if (isRunning()) console.log("stack already running: skipping `supabase start`");
      else {
        console.log("starting the stack (supabase start)...");
        if (runInherited(["supabase", "start"]) !== 0) fail("supabase start failed (see above). Is Docker running?");
      }
      dbReset();
      await writeAllEnvFiles();
      verify();
      summary();
      return;
    case "reset":
      ensureCli();
      dbReset();
      await writeAllEnvFiles();
      verify();
      summary();
      return;
    case "env":
      await writeAllEnvFiles();
      return;
    case "down":
      ensureCli();
      process.exit(runInherited(["supabase", "stop"]));
      return;
    default:
      console.error("usage: bun scripts/local-dev.ts <up|reset|env|down>");
      process.exit(64);
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
