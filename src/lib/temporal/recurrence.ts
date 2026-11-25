import { partsInZone, zonedTimeToUtc } from "./zone";

/**
 * Evaluating the small RRULE dialect MeOS stores — the half `resolveRecurrence`
 * writes and nothing evaluated until now (§v2.1: recurring tasks and alarms).
 *
 * All arithmetic happens on wall-clock parts in the user's zone, then converts
 * back to an instant: "every day at 07:00" must stay 07:00 through a DST
 * change, which adding 24 hours to an instant does not do.
 *
 * The dialect is deliberately what the app can honour, nothing more:
 * FREQ=DAILY | WEEKLY | MONTHLY | YEARLY, plus WEEKLY;BYDAY=MO,TU,…
 */

const BYDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

interface ParsedRule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  /** Weekday numbers 0–6 (Sunday 0), empty when the rule has no BYDAY. */
  byday: number[];
  /** Last instant an occurrence may land on. A course of medication ends. */
  until: Date | null;
}

/** RFC 5545 basic format, UTC: 20260827T040000Z. */
const UNTIL_PATTERN = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

export function formatUntil(instant: Date): string {
  return instant
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/** Null for anything outside the dialect — an unevaluable rule must not advance. */
export function parseRrule(rrule: string): ParsedRule | null {
  const parts = new Map(
    rrule
      .split(";")
      .map((part) => part.split("=") as [string, string])
      .filter(([k, v]) => k && v),
  );
  const freq = parts.get("FREQ");
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") {
    return null;
  }
  const byday: number[] = [];
  for (const code of (parts.get("BYDAY") ?? "").split(",").filter(Boolean)) {
    const index = BYDAY_CODES.indexOf(code as (typeof BYDAY_CODES)[number]);
    if (index === -1) return null;
    byday.push(index);
  }
  let until: Date | null = null;
  const untilRaw = parts.get("UNTIL");
  if (untilRaw) {
    const m = UNTIL_PATTERN.exec(untilRaw);
    if (!m) return null;
    until = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
  }
  return { freq, byday, until };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The next occurrence strictly after `after`, keeping the wall-clock time of
 * `anchor` (the occurrence being advanced from).
 *
 * Monthly and yearly rules keep the anchor's day-of-month and skip periods
 * that lack it — "the 31st, monthly" means the months that have a 31st, and
 * Feb 29 yearly means leap years, the same reading `resolveCalendarPhrase`
 * settled on. Returns null only for rules outside the dialect or dates that
 * never recur (day 32 does not exist anywhere).
 */
export function nextOccurrence(
  rrule: string,
  anchor: Date,
  after: Date,
  timeZone: string,
): Date | null {
  const rule = parseRrule(rrule);
  if (!rule) return null;

  // Past the course's end there is no next occurrence — the rule is finished,
  // and completion falls through to ordinary "done for good".
  const withinUntil = (candidate: Date) =>
    rule.until === null || candidate.getTime() <= rule.until.getTime();

  const base = partsInZone(anchor, timeZone);

  if (rule.freq === "DAILY" || rule.freq === "WEEKLY") {
    /*
     * Walk forward a day at a time from the anchor. Bounded at ten years of
     * days — generous, because the anchor can be genuinely stale: an item
     * untouched for three years must still advance to a real next occurrence
     * rather than quietly completing forever (review finding).
     */
    const stepDays = rule.freq === "WEEKLY" && rule.byday.length === 0 ? 7 : 1;
    for (let offset = stepDays; offset <= 3660; offset += stepDays) {
      const candidate = zonedTimeToUtc(
        timeZone,
        base.year,
        base.month,
        base.day + offset,
        base.hour,
        base.minute,
      );
      if (candidate.getTime() <= after.getTime()) continue;
      if (!withinUntil(candidate)) return null;
      if (rule.byday.length === 0) return candidate;
      if (rule.byday.includes(partsInZone(candidate, timeZone).weekday)) return candidate;
    }
    return null;
  }

  if (rule.freq === "MONTHLY") {
    for (let step = 1; step <= 132; step += 1) {
      const total = base.month + step;
      const year = base.year + Math.floor((total - 1) / 12);
      const month = ((total - 1) % 12) + 1;
      if (base.day > daysInMonth(year, month)) continue;
      const candidate = zonedTimeToUtc(timeZone, year, month, base.day, base.hour, base.minute);
      if (candidate.getTime() > after.getTime()) return withinUntil(candidate) ? candidate : null;
    }
    return null;
  }

  // YEARLY — enough steps to clear a stale anchor plus the leap-year gap.
  for (let step = 1; step <= 16; step += 1) {
    const year = base.year + step;
    if (base.day > daysInMonth(year, base.month)) continue;
    const candidate = zonedTimeToUtc(timeZone, year, base.month, base.day, base.hour, base.minute);
    if (candidate.getTime() > after.getTime()) return withinUntil(candidate) ? candidate : null;
  }
  return null;
}

/**
 * Where a completed recurring item's date moves to: the next occurrence after
 * *now* or after the stored date, whichever is later. Ticking off Monday's
 * run on Wednesday must land on Thursday, not on the missed Tuesday — done
 * means done with this round, never "now clear the backlog one tap at a time".
 */
export function advancedDueAt(
  rrule: string,
  dueAt: Date,
  now: Date,
  timeZone: string,
): Date | null {
  const after = now.getTime() > dueAt.getTime() ? now : dueAt;
  return nextOccurrence(rrule, dueAt, after, timeZone);
}

/** "every weekday", "every day until 27 Aug" — how a stored rule reads on a card. */
export function describeRrule(rrule: string, timeZone?: string): string | null {
  const rule = parseRrule(rrule);
  if (!rule) return null;
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  let base: string;
  if (rule.freq === "WEEKLY" && rule.byday.length > 0) {
    const sorted = [...rule.byday].sort((a, b) => a - b);
    base =
      sorted.join(",") === "1,2,3,4,5"
        ? "every weekday"
        : `every ${sorted.map((day) => names[day]).join(" and ")}`;
  } else {
    base = { DAILY: "every day", WEEKLY: "every week", MONTHLY: "every month", YEARLY: "every year" }[
      rule.freq
    ];
  }

  if (rule.until) {
    const label = new Intl.DateTimeFormat("en-GB", {
      ...(timeZone ? { timeZone } : {}),
      day: "numeric",
      month: "short",
    }).format(rule.until);
    return `${base} until ${label}`;
  }
  return base;
}
