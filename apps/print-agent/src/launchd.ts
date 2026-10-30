// Installs or removes the macOS LaunchAgent that starts the print agent at login
// (11.operations.md "Order ticket printer").
//
//   bun run launchd:install     write ~/Library/LaunchAgents/com.marmitop.print-agent.plist and load it
//   bun run launchd:uninstall   unload it and delete the plist

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LABEL = "com.marmitop.print-agent";
const AGENT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const TEMPLATE = join(AGENT_DIR, "launchd", `${LABEL}.plist`);
const TARGET = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const LOG_DIR = join(homedir(), "Library", "Logs", "Marmitop");
const domain = `gui/${process.getuid?.() ?? 501}`;

function launchctl(...args: string[]): number {
  return Bun.spawnSync(["launchctl", ...args], { stdout: "inherit", stderr: "inherit" }).exitCode ?? 1;
}

const command = process.argv[2];
if (command === "install") {
  if (!existsSync(join(AGENT_DIR, ".env"))) {
    console.error("Write apps/print-agent/.env first (see .env.example).");
    process.exit(1);
  }
  const plist = readFileSync(TEMPLATE, "utf8")
    .replaceAll("__BUN__", process.execPath)
    .replaceAll("__AGENT_DIR__", AGENT_DIR)
    .replaceAll("__LOG_DIR__", LOG_DIR);
  mkdirSync(dirname(TARGET), { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });
  // A loaded old copy keeps running the old plist; unload it first (an error here means it was not loaded).
  Bun.spawnSync(["launchctl", "bootout", `${domain}/${LABEL}`], { stdout: "ignore", stderr: "ignore" });
  writeFileSync(TARGET, plist);
  if (launchctl("bootstrap", domain, TARGET) !== 0) process.exit(1);
  console.log(`Loaded ${LABEL}. Log: ${join(LOG_DIR, "print-agent.log")}`);
} else if (command === "uninstall") {
  Bun.spawnSync(["launchctl", "bootout", `${domain}/${LABEL}`], { stdout: "ignore", stderr: "ignore" });
  rmSync(TARGET, { force: true });
  console.log(`Removed ${LABEL}.`);
} else {
  console.error("Usage: bun src/launchd.ts install | uninstall");
  process.exit(1);
}
