/**
 * The trip-brain cross-check (§v2.1): a passport expiry held against a trip's
 * dates, at the moment the trip is being captured — when rebooking is cheap —
 * instead of at the airport, when it is a ruined morning.
 *
 * Pure: the analyze route feeds it the trip's end date and the user's
 * passports; it answers with a sentence or silence. The six-month rule is a
 * heads-up, not law — many countries demand six months' validity past entry,
 * many don't — and the copy says "many", never "yours does".
 */

/** Months of validity many countries require beyond the trip. */
export const PASSPORT_VALIDITY_MONTHS = 6;

export interface PassportRow {
  display_name: string;
  /** ISO date (YYYY-MM-DD). */
  expiration_date: string;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${iso}T00:00:00Z`));
}

/**
 * One sentence, or null when there is nothing worth saying.
 *
 * `tripEndIso` is the trip's last day (falling back to its start when no end
 * was stated — a shorter window, so it can only under-warn, never cry wolf).
 * The soonest-expiring passport is the one that matters: the warning names
 * it, because "a passport" sends the user checking all of them.
 */
export function passportNotice(tripEndIso: string, passports: PassportRow[]): string | null {
  const candidates = passports
    .filter((p) => p.expiration_date)
    .sort((a, b) => a.expiration_date.localeCompare(b.expiration_date));
  const passport = candidates[0];
  if (!passport) return null;

  const tripEnd = new Date(`${tripEndIso}T00:00:00Z`);
  const expiry = new Date(`${passport.expiration_date}T00:00:00Z`);

  if (expiry.getTime() < tripEnd.getTime()) {
    return `${passport.display_name} expires ${formatDate(passport.expiration_date)} — before this trip ends. That needs sorting before anything else is booked.`;
  }

  // Six CALENDAR months, the way a border officer counts them — 30-day
  // approximations missed expiries sitting exactly on the boundary the rule
  // targets (review finding).
  const sixMonthsAfterTrip = new Date(
    Date.UTC(
      tripEnd.getUTCFullYear(),
      tripEnd.getUTCMonth() + PASSPORT_VALIDITY_MONTHS,
      tripEnd.getUTCDate(),
    ),
  );
  if (expiry.getTime() < sixMonthsAfterTrip.getTime()) {
    return `${passport.display_name} expires ${formatDate(passport.expiration_date)} — less than six months after this trip. Many countries require six; worth checking the destination's rule before booking.`;
  }

  return null;
}
