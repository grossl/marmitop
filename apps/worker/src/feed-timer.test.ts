// covers FR-174 (ADR-023): the worker timer that enqueues event-feed reads.
import { describe, expect, test } from "bun:test";

import { FeedPullTimer } from "./feed-timer";

describe("FeedPullTimer", () => {
  test("calls the enqueue function with MT_UATIS_PULL_SECONDS on every tick, and stops", async () => {
    const calls: number[] = [];
    const timer = new FeedPullTimer({
      pullSeconds: 1,
      intervalMs: 5,
      enqueue: async (s) => {
        calls.push(s);
        return 0;
      },
      log: { info() {}, warn() {}, error() {} },
    });
    timer.start();
    await Bun.sleep(30);
    await timer.stop();
    const seen = calls.length;
    expect(seen).toBeGreaterThanOrEqual(2);
    expect(new Set(calls)).toEqual(new Set([1]));
    await Bun.sleep(20);
    expect(calls.length).toBe(seen);
  });

  test("a failing tick is logged and the timer keeps going", async () => {
    let n = 0;
    const errors: string[] = [];
    const timer = new FeedPullTimer({
      pullSeconds: 3,
      intervalMs: 5,
      enqueue: async () => {
        n++;
        throw new Error("db down");
      },
      log: { info() {}, warn() {}, error: (m: string) => void errors.push(m) },
    });
    timer.start();
    await Bun.sleep(30);
    await timer.stop();
    expect(n).toBeGreaterThanOrEqual(2);
    expect(errors.length).toBe(n);
  });
});
