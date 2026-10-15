// The event-feed timer (ADR-023, FR-174). pg_cron cannot read the worker's environment and
// runs at most once per second, so the worker itself calls
// `mt.enqueue_uatis_feed_pulls(MT_UATIS_PULL_SECONDS)` every MT_UATIS_PULL_SECONDS. The SQL
// function decides which restaurants are due (pull: older than that many seconds; push: older
// than 5 minutes) and never enqueues a second job while one waits, so several worker processes
// can run the timer at once.

import type { Logger } from "./framework/types";

export interface FeedPullTimerOptions {
  readonly pullSeconds: number;
  /** Defaults to `pullSeconds * 1000`. */
  readonly intervalMs?: number;
  readonly enqueue: (pullSeconds: number) => Promise<number>;
  readonly log: Logger;
}

export class FeedPullTimer {
  private handle: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private stopped = true;

  constructor(private readonly options: FeedPullTimerOptions) {}

  start(): void {
    this.stopped = false;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.handle) clearTimeout(this.handle);
    this.handle = null;
    await this.running;
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    this.handle = setTimeout(() => {
      this.running = this.tick().finally(() => {
        this.running = null;
        this.schedule(this.options.intervalMs ?? this.options.pullSeconds * 1000);
      });
    }, ms);
  }

  private async tick(): Promise<void> {
    try {
      await this.options.enqueue(this.options.pullSeconds);
    } catch (error) {
      this.options.log.error("uatis feed timer: enqueue failed", { error: (error as Error)?.message ?? "unknown" });
    }
  }
}
