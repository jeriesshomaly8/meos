/**
 * Timezone arithmetic built on `Intl`, with no new dependency.
 *
 * Every date boundary in MeOS goes through this module and every function
 * takes an explicit IANA zone. That is deliberate: the v1 bug was that
 * `profiles.timezone` was collected, sent to the AI, and then ignored by every
 * read path, which used the *server's* midnight. A user in Asia/Jerusalem saw
 * the wrong day for three hours every evening on a UTC host.
 *
 * There is no `new Date()` default anywhere in here — callers pass the clock,
 * which is also what makes the tests deterministic.
 */

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = formatterCache.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatterCache.set(timeZone, cached);
  }
  return cached;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock fields of `instant` as seen in `timeZone`. */
export function partsInZone(instant: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "0";

  // Intl renders midnight as hour 24 in some engines; normalise to 0.
  const hour = Number(get("hour")) % 24;

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
export function offsetAt(instant: Date, timeZone: string): number {
  const p = partsInZone(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Second precision is enough: no IANA zone has a sub-second offset.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which the given wall-clock time occurs in `timeZone`.
 *
 * Two passes because the offset depends on the answer: guess with the offset
 * at the naive instant, then re-read the offset at that corrected instant.
 * This lands correctly on both sides of a DST transition.
 */
export function zonedTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstGuess = new Date(naive - offsetAt(new Date(naive), timeZone));
  return new Date(naive - offsetAt(firstGuess, timeZone));
}

/** Midnight at the start of `instant`'s local day, as a UTC instant. */
export function startOfDayInZone(instant: Date, timeZone: string): Date {
  const p = partsInZone(instant, timeZone);
  return zonedTimeToUtc(timeZone, p.year, p.month, p.day);
}

/** The last representable millisecond of `instant`'s local day. */
export function endOfDayInZone(instant: Date, timeZone: string): Date {
  const start = startOfDayInZone(instant, timeZone);
  const nextDay = addDaysInZone(start, 1, timeZone);
  return new Date(nextDay.getTime() - 1);
}

/**
 * Adds whole calendar days in the given zone.
 *
 * Not `+ n * 86_400_000`: across a DST boundary that lands an hour early or
 * late, and "tomorrow" would silently become "today at 23:00".
 */
export function addDaysInZone(instant: Date, days: number, timeZone: string): Date {
  const p = partsInZone(instant, timeZone);
  return zonedTimeToUtc(timeZone, p.year, p.month, p.day + days, p.hour, p.minute, p.second);
}

/** Whole calendar days between two instants as counted in `timeZone`. */
export function daysBetweenInZone(from: Date, to: Date, timeZone: string): number {
  const a = startOfDayInZone(from, timeZone).getTime();
  const b = startOfDayInZone(to, timeZone).getTime();
  // Round because a DST shift makes the raw difference 23 or 25 hours.
  return Math.round((b - a) / 86_400_000);
}

export function isSameDayInZone(a: Date, b: Date, timeZone: string): boolean {
  return daysBetweenInZone(a, b, timeZone) === 0;
}

/** `YYYY-MM-DD` for the local day containing `instant`. */
export function isoDateInZone(instant: Date, timeZone: string): string {
  const p = partsInZone(instant, timeZone);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(
    p.day,
  ).padStart(2, "0")}`;
}
