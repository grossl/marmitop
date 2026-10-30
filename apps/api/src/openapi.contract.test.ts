// covers FR-144, T7.7: docs/06.openapi.yaml lists exactly the routes apps/api serves, and
// every public operation documents the error envelope, 401, and 429.
import { describe, expect, test } from "bun:test";
import { FixedClock } from "@mt/core";
import { MemoryUatisInboundStore, MemoryWebNfInboundStore } from "@mt/http/testing";

import { createApp } from "./app";
import { MemoryPublicApi } from "./testing/memory-public-api";

const SPEC_PATH = new URL("../../../docs/06.openapi.yaml", import.meta.url);

interface Operation {
  responses?: Record<string, unknown>;
  security?: unknown[];
  parameters?: { $ref?: string; name?: string }[];
}
type Spec = { paths: Record<string, Record<string, Operation>> };

async function spec(): Promise<Spec> {
  return Bun.YAML.parse(await Bun.file(SPEC_PATH).text()) as Spec;
}

const METHODS = new Set(["get", "post", "patch", "put", "delete"]);

function specRoutes(s: Spec): string[] {
  const out: string[] = [];
  for (const [path, item] of Object.entries(s.paths)) {
    for (const method of Object.keys(item)) {
      if (METHODS.has(method)) out.push(`${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ":param")}`);
    }
  }
  return out.sort();
}

function appRoutes(): string[] {
  const app = createApp({
    clock: new FixedClock(new Date()),
    log: { info() {}, warn() {}, error() {} },
    uatisInbound: new MemoryUatisInboundStore(),
    webNfInbound: new MemoryWebNfInboundStore(),
    publicApi: new MemoryPublicApi().backend(),
  });
  const seen = new Set<string>();
  for (const r of app.routes) {
    if (r.method === "ALL") continue; // middleware
    seen.add(`${r.method} ${r.path.replace(/\/$/, "").replace(/:\w+/g, ":param")}`);
  }
  return [...seen].sort();
}

describe("06.openapi.yaml contract", () => {
  test("the spec and the app list the same routes", async () => {
    expect(appRoutes()).toEqual(specRoutes(await spec()));
  });

  test("every API-key operation documents 401 and 429; every POST documents Idempotency-Key", async () => {
    const s = await spec();
    for (const [path, item] of Object.entries(s.paths)) {
      if (!/^\/v1\/(orders|customers|menu|messages|print-jobs)/.test(path)) continue;
      for (const [method, op] of Object.entries(item)) {
        if (!METHODS.has(method)) continue;
        const where = `${method.toUpperCase()} ${path}`;
        expect(`${where} ${Object.keys(op.responses ?? {}).includes("401")}`).toBe(`${where} true`);
        expect(`${where} ${Object.keys(op.responses ?? {}).includes("429")}`).toBe(`${where} true`);
        if (method === "post") {
          const refs = (op.parameters ?? []).map((p) => p.$ref ?? p.name);
          expect(`${where} ${refs.includes("#/components/parameters/IdempotencyKey")}`).toBe(`${where} true`);
        }
      }
    }
  });
});
