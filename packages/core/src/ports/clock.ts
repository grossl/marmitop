// Clock port. Every time-based rule takes a Clock (or an instant) so tests stay deterministic.

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
