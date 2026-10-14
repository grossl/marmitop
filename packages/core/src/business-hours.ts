// Business hours (FR-083, FR-096, FR-113). `isOpenAt` is the only function that
// decides open or closed. Pure: time zones come from Intl, with no I/O.

export interface BusinessHoursRow {
  /** 0 = Sunday .. 6 = Saturday. */
  readonly weekday: number;
  readonly enabled: boolean;
  /** "HH:MM" or "HH:MM:SS", local time in the restaurant timezone. */
  readonly opensAt: string;
  /** When earlier than `opensAt`, the window ends on the next day. */
  readonly closesAt: string;
}

export interface LocalParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  /** 0 = Sunday .. 6 = Saturday. */
  readonly weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timezone, f);
  }
  return f;
}

/** Wall-clock parts of `instant` in `timezone` (an IANA name). Throws on an unknown zone. */
export function localParts(instant: Date, timezone: string): LocalParts {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(timezone).formatToParts(instant)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const year = parts.year as number;
  const month = parts.month as number;
  const day = parts.day as number;
  return {
    year,
    month,
    day,
    hour: (parts.hour as number) % 24,
    minute: parts.minute as number,
    second: parts.second as number,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

/** The local calendar day as `YYYY-MM-DD`. Report and KPI day boundaries use this. */
export function localDay(instant: Date, timezone: string): string {
  const p = localParts(instant, timezone);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Weekday (0 = Sunday) of `instant` in `timezone`. */
export function weekdayInTimezone(instant: Date, timezone: string): number {
  return localParts(instant, timezone).weekday;
}

function secondsOfDay(time: string): number {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!m) throw new RangeError(`invalid time "${time}"`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
}

/**
 * True when the restaurant is open at `instant`. The opening time is included and
 * the closing time is excluded. A window whose `closesAt` is earlier than `opensAt`
 * runs past midnight into the next day, so the early hours read the previous day's row.
 */
export function isOpenAt(hours: readonly BusinessHoursRow[], timezone: string, instant: Date): boolean {
  const local = localParts(instant, timezone);
  const now = local.hour * 3600 + local.minute * 60 + local.second;
  const today = hours.find((h) => h.weekday === local.weekday);
  if (today?.enabled) {
    const opens = secondsOfDay(today.opensAt);
    const closes = secondsOfDay(today.closesAt);
    if (opens < closes && now >= opens && now < closes) return true;
    if (closes < opens && now >= opens) return true;
  }
  const yesterday = hours.find((h) => h.weekday === (local.weekday + 6) % 7);
  if (yesterday?.enabled) {
    const opens = secondsOfDay(yesterday.opensAt);
    const closes = secondsOfDay(yesterday.closesAt);
    if (closes < opens && now < closes) return true;
  }
  return false;
}

function offsetMs(instant: number, timezone: string): number {
  const p = localParts(new Date(instant), timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant at which the wall clock in `timezone` reads the given local date and seconds-of-day. */
function zonedToInstant(year: number, month: number, day: number, sod: number, timezone: string): number {
  const wall = Date.UTC(year, month - 1, day, 0, 0, sod);
  let guess = wall - offsetMs(wall, timezone);
  const corrected = wall - offsetMs(guess, timezone);
  if (corrected !== guess) guess = corrected;
  return guess;
}

/**
 * The next instant, strictly after `instant`, at which a window opens. Null when no
 * weekday is enabled. Looks eight days ahead, which covers every weekday.
 */
export function nextOpening(hours: readonly BusinessHoursRow[], timezone: string, instant: Date): Date | null {
  const local = localParts(instant, timezone);
  let best: number | null = null;
  for (let offset = 0; offset <= 8; offset++) {
    const date = new Date(Date.UTC(local.year, local.month - 1, local.day + offset));
    const row = hours.find((h) => h.weekday === date.getUTCDay());
    if (!row?.enabled) continue;
    const opens = secondsOfDay(row.opensAt);
    if (opens === secondsOfDay(row.closesAt)) continue;
    const candidate = zonedToInstant(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), opens, timezone);
    if (candidate > instant.getTime() && (best === null || candidate < best)) best = candidate;
  }
  return best === null ? null : new Date(best);
}
