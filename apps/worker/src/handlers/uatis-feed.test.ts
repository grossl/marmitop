// covers FR-174, FR-175, FR-176 (ADR-023): the event-feed job.
import { beforeEach, describe, expect, test } from "bun:test";
import { FakeGateway, FixedClock, GatewayError, type UatisWebhookEvent } from "@mt/core";
import { QUEUES } from "@mt/db";

import type { JobContext } from "../framework/types";
import { createUatisFeedHandler, type FeedState, type FeedStore } from "./uatis-feed";
import type { ReconcileConnection, ReconcileStore } from "./whatsapp-reconcile";

const R = "3f6c1a0e-7a3b-4b1e-9c53-1f3f6d0f6a11";
const NOW = new Date("2026-10-14T12:00:00Z");

const connection: ReconcileConnection = {
  baseUrl: "http://uatis.local",
  apiKey: "k",
  phoneNumberId: "pn-1",
  status: "connected",
  lastSyncCursor: null,
};

class MemoryFeedStore implements FeedStore {
  state: FeedState | null = null;
  applied: { eventId: string | null; cursor: string; type: string }[] = [];
  receipts = new Set<string>();
  duplicates = 0;
  cursorWrites: (string | null)[] = [];
  syncedAt: Date | null = null;
  errors: string[] = [];
  failOnCursor: string | null = null;

  async loadFeedState() {
    return this.state;
  }
  async applyEvent(_r: string, event: UatisWebhookEvent, eventId: string | null, cursor: string) {
    if (cursor === this.failOnCursor) throw new Error("db error");
    if (eventId !== null && this.receipts.has(eventId)) {
      this.duplicates++;
    } else {
      if (eventId !== null) this.receipts.add(eventId);
      this.applied.push({ eventId, cursor, type: event.type });
    }
    if (this.state) this.state = { ...this.state, cursor };
    this.cursorWrites.push(cursor);
    return "applied";
  }
  async setCursor(_r: string, cursor: string | null) {
    if (this.state) this.state = { ...this.state, cursor };
    this.cursorWrites.push(cursor);
  }
  async markSynced(_r: string, at: Date) {
    this.syncedAt = at;
  }
  async markError(_r: string, message: string) {
    this.errors.push(message);
  }
  cleared = 0;
  async clearWebhook() {
    this.cleared++;
    if (this.state) this.state = { ...this.state, webhookId: null, cursor: null };
  }
}

class NullReconcileStore implements ReconcileStore {
  advanced = 0;
  async loadConnection() {
    return connection;
  }
  async applyMessage() {
    return "ingested";
  }
  async advanceCursor() {
    this.advanced++;
  }
  async markError() {}
}

let store: MemoryFeedStore;
let reconcile: NullReconcileStore;
let gateway: FakeGateway;
let webhookId: string;
const warnings: string[] = [];
const clock = new FixedClock(NOW);
const ctx = (): JobContext<{ v: 1; restaurantId: string; op: "uatis_feed_pull" }> => ({
  queue: QUEUES.sync,
  msgId: 1,
  payload: { v: 1, restaurantId: R, op: "uatis_feed_pull" },
  attempt: 1,
  readCount: 1,
  signal: new AbortController().signal,
});
const handler = (pageSize = 100) =>
  createUatisFeedHandler({
    store,
    reconcileStore: reconcile,
    gatewayFor: () => gateway,
    clock,
    pageSize,
    log: { info() {}, warn: (m: string) => void warnings.push(m), error() {} },
  });

beforeEach(async () => {
  gateway = new FakeGateway({ clock });
  const hook = await gateway.createWebhook({
    mode: "pull",
    url: null,
    events: ["message.created", "message.updated"],
    description: null,
  });
  webhookId = hook.id;
  store = new MemoryFeedStore();
  store.state = { connection, webhookId, organizationId: gateway.organization.id, cursor: null };
  reconcile = new NullReconcileStore();
  warnings.length = 0;
});

const feed = () => gateway.feeds.get(webhookId) ?? [];

describe("uatis_feed_pull", () => {
  test("applies every event in order, stores the last cursor, and marks the read", async () => {
    gateway.simulateInbound({ from: "+5511999990001", body: "um" });
    gateway.simulateInbound({ from: "+5511999990002", body: "dois" });
    gateway.simulateInbound({ from: "+5511999990003", body: "três" });
    expect(await handler().run(ctx())).toEqual({ kind: "ok" });
    expect(store.applied).toHaveLength(3);
    expect(store.state?.cursor).toBe(feed()[2]?.cursor ?? "missing");
    expect(store.syncedAt).toEqual(NOW);
  });

  test("starts after the stored cursor", async () => {
    gateway.simulateInbound({ from: "+5511999990001", body: "um" });
    gateway.simulateInbound({ from: "+5511999990002", body: "dois" });
    store.state = { ...(store.state as FeedState), cursor: feed()[0]?.cursor ?? null };
    await handler().run(ctx());
    expect(store.applied.map((a) => a.cursor)).toEqual([feed()[1]?.cursor ?? "missing"]);
  });

  test("walks every page", async () => {
    for (let i = 0; i < 5; i++) gateway.simulateInbound({ from: `+551199999000${i}`, body: `m${i}` });
    await handler(2).run(ctx());
    expect(store.applied).toHaveLength(5);
  });

  test("a failed apply stops the run with the cursor at the last committed event", async () => {
    gateway.simulateInbound({ from: "+5511999990001", body: "um" });
    gateway.simulateInbound({ from: "+5511999990002", body: "dois" });
    gateway.simulateInbound({ from: "+5511999990003", body: "três" });
    store.failOnCursor = feed()[1]?.cursor ?? null;
    await expect(handler().run(ctx())).rejects.toThrow("db error");
    expect(store.state?.cursor).toBe(feed()[0]?.cursor ?? "missing");
    expect(store.syncedAt).toBeNull();
  });

  test("a second read of the same events applies nothing new (dedupe by event id)", async () => {
    gateway.simulateInbound({ from: "+5511999990001", body: "um" });
    await handler().run(ctx());
    store.state = { ...(store.state as FeedState), cursor: null };
    await handler().run(ctx());
    expect(store.applied).toHaveLength(1);
    expect(store.duplicates).toBe(1);
  });

  test("410 cursor_expired resets the cursor and warns", async () => {
    store.state = { ...(store.state as FeedState), cursor: "expired" };
    gateway.failNext("listWebhookEvents", new GatewayError({ kind: "http", status: 410, code: "cursor_expired" }));
    expect(await handler().run(ctx())).toEqual({ kind: "ok" });
    expect(store.state?.cursor).toBeNull();
    expect(warnings.some((w) => w.includes("cursor"))).toBe(true);
  });

  test("404 while the webhook exists means no feed (older backend-uatis): timestamp poll", async () => {
    gateway.failNext("listWebhookEvents", GatewayError.http(404, "not_found"));
    expect(await handler().run(ctx())).toEqual({ kind: "ok" });
    expect(gateway.calls.some((c) => c.method === "getWebhook")).toBe(true);
    expect(gateway.calls.some((c) => c.method === "listMessages")).toBe(true);
    expect(reconcile.advanced).toBe(1);
    expect(store.cleared).toBe(0);
  });

  test("404 for a webhook backend-uatis no longer has: clear it and run the timestamp poll", async () => {
    await gateway.deleteWebhook(webhookId);
    expect(await handler().run(ctx())).toEqual({ kind: "ok" });
    expect(store.cleared).toBe(1);
    expect(reconcile.advanced).toBe(1);
    expect(warnings.some((w) => w.includes("no longer exists"))).toBe(true);
  });

  test("400 for a foreign cursor resets the cursor", async () => {
    store.state = { ...(store.state as FeedState), cursor: "foreign" };
    gateway.failNext("listWebhookEvents", GatewayError.http(400, "validation_failed"));
    expect(await handler().run(ctx())).toEqual({ kind: "ok" });
    expect(store.state?.cursor).toBeNull();
  });

  test("403 (a member key) marks the integration error with the admin-key text", async () => {
    gateway.failNext("listWebhookEvents", GatewayError.http(403, "forbidden"));
    expect((await handler().run(ctx())).kind).toBe("fail");
    expect(store.errors).toEqual(["A chave da API do Uatis precisa ser de administrador."]);
  });

  test("a page shorter than the limit ends the run (next_cursor echoes, it never means more)", async () => {
    gateway.simulateInbound({ from: "+5511999990001", body: "um" });
    await handler(2).run(ctx());
    expect(gateway.calls.filter((c) => c.method === "listWebhookEvents")).toHaveLength(1);
  });

  test("an event from another organization is skipped and the cursor still moves", async () => {
    store.state = { ...(store.state as FeedState), organizationId: "99999999-9999-4999-8999-999999999999" };
    gateway.simulateInbound({ from: "+5511999990001", body: "um" });
    await handler().run(ctx());
    expect(store.applied).toHaveLength(0);
    expect(store.state?.cursor).toBe(feed()[0]?.cursor ?? "missing");
  });

  test("a malformed event is skipped and the cursor still moves", async () => {
    feed().push({ cursor: "999999999999", event: { id: "x", type: "message.created", data: { message: { id: "" } } } });
    await handler().run(ctx());
    expect(store.applied).toHaveLength(0);
    expect(store.state?.cursor).toBe("999999999999");
  });

  test("a refused key marks the integration error and does not retry", async () => {
    gateway.failNext("listWebhookEvents", GatewayError.http(401, "unauthorized"));
    const outcome = await handler().run(ctx());
    expect(outcome.kind).toBe("fail");
    expect(store.errors).toEqual(["A chave de API foi recusada pelo backend-uatis."]);
  });

  test("a 5xx is retried", async () => {
    gateway.failNext("listWebhookEvents", GatewayError.http(503));
    expect((await handler().run(ctx())).kind).toBe("retry");
  });

  test("no registered webhook or a disconnected integration does nothing", async () => {
    store.state = { ...(store.state as FeedState), webhookId: null };
    expect(await handler().run(ctx())).toEqual({ kind: "ok" });
    store.state = { ...(store.state as FeedState), webhookId, connection: { ...connection, status: "disconnected" } };
    expect(await handler().run(ctx())).toEqual({ kind: "ok" });
    expect(gateway.calls.filter((c) => c.method === "listWebhookEvents")).toHaveLength(0);
  });
});
