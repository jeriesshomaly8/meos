import { isoDateInZone, partsInZone, zonedTimeToUtc } from "./zone";

/**
 * Adapters between stored instants and the strings `<input type="date">` and
 * `<input type="datetime-local">` speak.
 *
 * They exist because the obvious version is wrong: `new Date("2026-08-14")`
 * parses as *UTC* midnight, so round-tripping an all-day date through a date
 * input moves the day for anyone west of Greenwich. Like the rest of
 * `src/lib/temporal`, every function here takes an explicit zone.
 */

/**
 * A timed date defaults to 09:00 rather than 00:00 when it gains a clock. A
 * task "due at midnight" reads as the previous evening to a human, and a
 * reminder nobody is awake for is a reminder that didn't happen.
 */
const DEFAULT_TIMED_HOUR = 9;

/** The browser's own zone — the one place a zone is discovered rather than passed. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const pad = (value: number): string => String(value).padStart(2, "0");

function toInstant(iso: string | null): Date | null {
  if (!iso) return null;
  const instant = new Date(iso);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** Instant → `yyyy-mm-dd` as seen in `timeZone`. Empty string when there is none. */
export function toDateInput(iso: string | null, timeZone: string): string {
  const instant = toInstant(iso);
  return instant ? isoDateInZone(instant, timeZone) : "";
}

/** `yyyy-mm-dd` → the instant at that day's local midnight. Null when cleared. */
export function fromDateInput(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  return zonedTimeToUtc(
    timeZone,
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ).toISOString();
}

/** Instant → `yyyy-mm-ddThh:mm` as seen in `timeZone`. Empty string when there is none. */
export function toDateTimeInput(iso: string | null, timeZone: string): string {
  const instant = toInstant(iso);
  if (!instant) return "";
  const parts = partsInZone(instant, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** `yyyy-mm-ddThh:mm` → instant. Null when cleared or half-typed. */
export function fromDateTimeInput(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  return zonedTimeToUtc(
    timeZone,
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  ).toISOString();
}

/**
 * Moves an instant between all-day and timed while keeping the day the user
 * chose. Toggling the switch must never silently change which day it is.
 */
export function setAllDay(iso: string | null, allDay: boolean, timeZone: string): string | null {
  const instant = toInstant(iso);
  if (!instant) return null;
  const parts = partsInZone(instant, timeZone);
  return zonedTimeToUtc(
    timeZone,
    parts.year,
    parts.month,
    parts.day,
    allDay ? 0 : DEFAULT_TIMED_HOUR,
    0,
  ).toISOString();
}
