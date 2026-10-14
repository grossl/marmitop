// covers FR-107, FR-108, ADR-002 Amendment 1 (timestamp cursor with a 60 s overlap)
import { beforeEach, describe, expect, test } from "bun:test";
import { FakeGateway, FixedClock, type GatewayMessage, GatewayError } from "@mt/core";
import { QUEUES } from "@mt/db";

import type { JobContext } from "../framework/types";
import { createWhatsAppReconcileHandler, type ReconcileConnection, type ReconcileStore } from "./whatsapp-reconcile";

const R = "3f6c1a0e-7a3b-4b1e-9c53-1f3f6d0f6a11";
const NOW = new Date("2026-10-13T15:00:00Z");

class MemoryReconcileStore implements ReconcileStore {
  connection: ReconcileConnection | null = {
    baseUrl: "http://uatis.local",
    apiKey: "k",
    phoneNumberId: "pn-1",
    status: "connected",
    lastSyncCursor: new Date("2026-10-13T14:59:00Z"),
  };
  stored = new Map<string, GatewayMessage>();
  cursor: Date | null = null;
  errors: string[] = [];
  failOn: string | null = null;
  async loadConnection() {
    return this.connection;
  }
  async applyMessage(_r: string, m: GatewayMessage) {
    if (m.externalId === this.failOn) throw new Error("db error");
    const dup = this.stored.has(m.externalId);
    this.stored.set(m.externalId, m);
    return dup ? "unchanged" : "ingested";
  }
  async advanceCursor(_r: string, cursor: Date | null) {
    this.cursor = cursor;
  }
  async markError(_r: string, message: string) {
    this.errors.push(message);
  }
}

let store: MemoryReconcileStore;
let gateway: FakeGateway;
const clock = new FixedClock(NOW);
const ctx = (): JobContext<{ v: 1; restaurantId: string; op: "whatsapp_reconcile" }> => ({
  queue: QUEUES.sync,
  msgId: 1,
  payload: { v: 1, restaurantId: R, op: "whatsapp_reconcile" },
  attempt: 1,
  readCount: 1,
  signal: new AbortController().signal,
});
const handler = (pageSize = 100) =>
  createWhatsAppReconcileHandler({
    store,
    gatewayFor: () => gateway,
    clock,
    pageSize,
    log: { info() {}, warn() {}, error() {} },
  });

beforeEach(() => {
  store = new MemoryReconcileStore();
  gateway = new FakeGateway({ clock });
});

describe("mt_sync whatsapp_reconcile handler", () => {
  test("a message missed by the webhook appears after one poll and the cursor advances (FR-107)", async () => {
    gateway.simulateInbound({ from: "+5511988887777", body: "Oi", at: new Date("2026-10-13T14:59:30Z") });
    expect(await handler().run(ctx())).toEqual({ kind: "ok" });
    expect([...store.stored.values()].map((m) => m.body)).toEqual(["Oi"]);
    expect(store.cursor?.toISOString()).toBe("2026-10-13T14:59:30.000Z");
  });

  test("it reads from the cursor minus 60 seconds, inbound only", async () => {
    await handler().run(ctx());
    const call = gateway.calls.find((c) => c.method === "listMessages");
    expect(call).toMatchObject({ input: { direction: "in", from: new Date("2026-10-13T14:58:00Z") } });
  });

  test("with no cursor it reads the last 24 hours", async () => {
    if (store.connection) store.connection = { ...store.connection, lastSyncCursor: null };
    await handler().run(ctx());
    const call = gateway.calls.find((c) => c.method === "listMessages");
    expect(call).toMatchObject({ input: { from: new Date("2026-10-12T15:00:00Z") } });
  });

  test("it walks every page and applies messages oldest first", async () => {
    for (let i = 0; i < 5; i++) {
      gateway.simulateInbound({
        from: "+5511988887777",
        body: `m${i}`,
        at: new Date(Date.parse("2026-10-13T14:59:10Z") + i * 1000),
      });
    }
    await handler(2).run(ctx());
    expect([...store.stored.values()].map((m) => m.body)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
    expect(store.cursor?.toISOString()).toBe("2026-10-13T14:59:14.000Z");
  });

  test("an empty poll keeps the cursor", async () => {
    await handler().run(ctx());
    expect(store.cursor?.toISOString()).toBe("2026-10-13T14:59:00.000Z");
  });

  test("a poll that runs twice stores each message once (overlap is safe)", async () => {
    gateway.simulateInbound({ from: "+5511988887777", body: "Oi", at: new Date("2026-10-13T14:59:30Z") });
    await handler().run(ctx());
    await handler().run(ctx());
    expect(store.stored.size).toBe(1);
  });

  test("a restaurant that is not connected is skipped", async () => {
    if (store.connection) store.connection = { ...store.connection, status: "error" };
    expect(await handler().run(ctx())).toEqual({ kind: "ok" });
    expect(gateway.calls).toHaveLength(0);
    store.connection = null;
    expect(await handler().run(ctx())).toEqual({ kind: "ok" });
  });

  test("a transient gateway error retries and does not move the cursor (FR-108)", async () => {
    const failing = new FakeGateway({ clock });
    failing.listMessages = async () => {
      throw GatewayError.http(503);
    };
    const h = createWhatsAppReconcileHandler({
      store,
      gatewayFor: () => failing,
      clock,
      log: { info() {}, warn() {}, error() {} },
    });
    expect(await h.run(ctx())).toEqual({ kind: "retry", errorCode: "upstream_error", httpStatus: 503 });
    expect(store.cursor).toBeNull();
  });

  test("a refused key fails at once and marks the integration in error", async () => {
    const failing = new FakeGateway({ clock });
    failing.listMessages = async () => {
      throw GatewayError.http(401, "unauthorized");
    };
    const h = createWhatsAppReconcileHandler({
      store,
      gatewayFor: () => failing,
      clock,
      log: { info() {}, warn() {}, error() {} },
    });
    expect(await h.run(ctx())).toEqual({ kind: "fail", errorCode: "unauthorized", httpStatus: 401 });
    expect(store.errors).toHaveLength(1);
  });

  test("a database error on one message leaves the cursor for the retry", async () => {
    const m = gateway.simulateInbound({ from: "+5511988887777", body: "Oi", at: new Date("2026-10-13T14:59:30Z") });
    store.failOn = m.externalId;
    await expect(handler().run(ctx())).rejects.toThrow("db error");
    expect(store.cursor).toBeNull();
  });

  test("the subject is the sync and the visibility timeout covers many pages", () => {
    const h = handler();
    expect(h.subjectType).toBe("sync");
    expect(h.subjectId(ctx().payload)).toBeNull();
    expect(h.visibilityTimeoutSeconds).toBeGreaterThanOrEqual(300);
  });
});
