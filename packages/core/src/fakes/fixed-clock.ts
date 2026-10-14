import type { Clock } from "../ports/clock";

/** Controllable clock for tests. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(initial: Date | string = new Date(0)) {
    this.current = new Date(initial);
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  set(date: Date | string): void {
    this.current = new Date(date);
  }
}
