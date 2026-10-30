// The local record of printed job ids, as a JSON file (FR-254, ADR-038). It keeps
// the last 500 ids; a job comes back within minutes, so older ids do not matter.
// A missing or broken file starts empty.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { PrintedRecord } from "./ports";

const KEEP = 500;

export class FilePrintedRecord implements PrintedRecord {
  private ids: string[];

  constructor(private readonly path: string) {
    this.ids = FilePrintedRecord.read(path);
  }

  private static read(path: string): string[] {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string").slice(-KEEP) : [];
    } catch {
      return [];
    }
  }

  has(id: string): boolean {
    return this.ids.includes(id);
  }

  add(id: string): void {
    if (this.has(id)) return;
    this.ids = [...this.ids, id].slice(-KEEP);
    mkdirSync(dirname(this.path), { recursive: true });
    // Write then rename, so a crash mid-write never leaves a half file.
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.ids));
    renameSync(tmp, this.path);
  }
}
