/**
 * Formats an instant in the user's IANA timezone as a human-readable string
 * for the extraction prompt. Falls back to UTC on invalid timezones so a bad
 * profile value can never break analysis.
 */
export function formatInTimeZoneSafe(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return `${date.toISOString()} (UTC — user timezone "${timezone}" was invalid)`;
  }
}

/** Validates an IANA timezone id. */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
