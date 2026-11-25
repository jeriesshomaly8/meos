import {
  addYears,
  differenceInCalendarDays,
  format,
  isValid,
  parseISO,
  setYear,
  startOfDay,
} from "date-fns";

/**
 * Dates whose year the user never told us are stored with this sentinel year
 * and `year_known = false`. The sentinel must never be shown in the UI.
 * 2000 is a leap year, so Feb 29 birthdays survive round-tripping.
 */
export const UNKNOWN_YEAR_SENTINEL = 2000;

export function parseDateOnly(iso: string): Date | null {
  const parsed = parseISO(iso);
  return isValid(parsed) ? parsed : null;
}

/**
 * Formats a stored date for display, hiding the sentinel year when the year
 * was never supplied ("September 22" instead of "September 22, 2000").
 */
export function formatEventDate(iso: string, yearKnown: boolean): string {
  const date = parseDateOnly(iso);
  if (!date) return iso;
  return yearKnown ? format(date, "MMMM d, yyyy") : format(date, "MMMM d");
}

/**
 * Next occurrence of an event, honoring yearly recurrence.
 * Returns null for one-off events already in the past.
 */
export function nextOccurrence(
  iso: string,
  recurrence: "none" | "yearly",
  today: Date = new Date(),
): Date | null {
  const date = parseDateOnly(iso);
  if (!date) return null;
  const todayStart = startOfDay(today);

  if (recurrence === "none") {
    return date < todayStart ? null : date;
  }

  let candidate = setYear(date, todayStart.getFullYear());
  if (candidate < todayStart) {
    candidate = addYears(candidate, 1);
  }
  return candidate;
}

/** Whole calendar days from today until the given date (0 = today). */
export function daysUntil(target: Date, today: Date = new Date()): number {
  return differenceInCalendarDays(startOfDay(target), startOfDay(today));
}

/** "today", "tomorrow", "in 12 days" */
export function daysUntilLabel(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 0) return `${Math.abs(days)} days ago`;
  return `in ${days} days`;
}

export type ExpiryStatus = "expired" | "expiring_soon" | "expiring_later" | "valid" | "unknown";

export const EXPIRY_SOON_DAYS = 90;
export const EXPIRY_LATER_DAYS = 365;

/** Traffic-light status for document expiration. */
export function expiryStatus(expirationIso: string | null, today: Date = new Date()): ExpiryStatus {
  if (!expirationIso) return "unknown";
  const expiration = parseDateOnly(expirationIso);
  if (!expiration) return "unknown";
  const days = daysUntil(expiration, today);
  if (days < 0) return "expired";
  if (days <= EXPIRY_SOON_DAYS) return "expiring_soon";
  if (days <= EXPIRY_LATER_DAYS) return "expiring_later";
  return "valid";
}

/**
 * Age someone turns on their upcoming birthday; null when their birth year is
 * unknown (sentinel year must never leak into age math).
 */
export function upcomingAge(
  birthdayIso: string,
  yearKnown: boolean,
  today: Date = new Date(),
): number | null {
  if (!yearKnown) return null;
  const birthday = parseDateOnly(birthdayIso);
  if (!birthday) return null;
  const next = nextOccurrence(birthdayIso, "yearly", today);
  if (!next) return null;
  return next.getFullYear() - birthday.getFullYear();
}
