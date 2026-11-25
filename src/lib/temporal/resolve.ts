import {
  addDaysInZone,
  isoDateInZone,
  partsInZone,
  startOfDayInZone,
  zonedTimeToUtc,
  type ZonedParts,
} from "./zone";
import { UNKNOWN_YEAR_SENTINEL } from "@/lib/dates";
import { formatUntil, nextOccurrence, parseRrule } from "./recurrence";

/**
 * Deterministic resolution of the date phrases people actually write.
 *
 * The v1 prompt asked the model to do this arithmetic ("resolve relative dates
 * against the current date above", "event date minus six months at 09:00") and
 * trusted whatever ISO string came back. That is non-deterministic, untestable
 * without a live API call, and produced dates that didn't line up with the
 * Today screen.
 *
 * v2 splits the work: the model reports the *phrase it saw* and this module
 * turns it into an instant — or refuses to, and hands the user a specific
 * question instead of a silent guess.
 */

export type Resolution =
  | {
      kind: "resolved";
      /** The instant, in UTC. */
      instant: Date;
      /** True when the user named a day but no clock time. */
      allDay: boolean;
      phrase: string;
    }
  | {
      /**
       * Two or more readings are genuinely defensible. Never pick one — the
       * confirmation UI asks, using `question`.
       */
      kind: "ambiguous";
      phrase: string;
      question: string;
      options: { label: string; instant: Date; allDay: boolean }[];
    }
  | { kind: "unresolved"; phrase: string };

export interface ResolveContext {
  /** The clock. Always passed explicitly so tests are deterministic. */
  now: Date;
  timeZone: string;
  /** Locale hint for day-first vs month-first numeric dates. */
  dayFirst?: boolean;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/** Default clock times for vague parts of the day, in local hours. */
const DAY_PART_HOURS: Record<string, number> = {
  morning: 9,
  noon: 12,
  afternoon: 14,
  evening: 18,
  tonight: 20,
  night: 20,
};

function label(instant: Date, timeZone: string, allDay: boolean): string {
  const opts: Intl.DateTimeFormatOptions = allDay
    ? { timeZone, weekday: "short", day: "numeric", month: "short" }
    : { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false };
  return new Intl.DateTimeFormat("en-GB", opts).format(instant);
}

interface ClockTime {
  hour: number;
  minute: number;
}

/**
 * Pulls a clock time out of the phrase: "at 8", "at 18:30", "6pm", "at 6".
 *
 * A bare hour of 1-11 with no am/pm marker is genuinely ambiguous, but in
 * practice "dinner at 8" means 20:00, so bare hours below 8 in an evening
 * context are handled by the caller supplying a day part. Here we only apply
 * the unambiguous rules and report what we found.
 */
function extractTime(text: string): { time: ClockTime | null; meridiemGiven: boolean } {
  /*
   * A day-part word beside a bare hour settles its meridiem: "every evening
   * at 8" means 20:00, and reading it as 08:00 was a confirmed review
   * finding. Morning keeps the hour; evening/night lift a small hour by 12.
   */
  const dayPart = Object.keys(DAY_PART_HOURS).find((word) =>
    new RegExp(`\\b${word}\\b`, "i").test(text),
  );
  const eveningish = dayPart === "evening" || dayPart === "night" || dayPart === "tonight";

  const explicit = /\b(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?\b/i.exec(text);
  if (explicit) {
    let hour = Number(explicit[1]);
    const minute = Number(explicit[2]);
    const meridiem = explicit[3]?.toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    if (!meridiem && eveningish && hour >= 1 && hour <= 11) hour += 12;
    if (hour <= 23 && minute <= 59) {
      // "19:30" needs no am/pm — an hour past 12 is already unambiguous
      // (review finding: the prompt's own "at 19:30" example resolved to
      // nothing because this used to demand a meridiem).
      return {
        time: { hour, minute },
        meridiemGiven: Boolean(meridiem) || hour >= 13 || Boolean(dayPart),
      };
    }
  }

  const bare = /\b(?:at\s+)?(\d{1,2})\s*(am|pm)\b/i.exec(text);
  if (bare) {
    let hour = Number(bare[1]);
    const meridiem = bare[2].toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    if (hour <= 23) return { time: { hour, minute: 0 }, meridiemGiven: true };
  }

  const atOnly = /\bat\s+(\d{1,2})\b/i.exec(text);
  if (atOnly) {
    let hour = Number(atOnly[1]);
    if (!eveningish && hour <= 23 && hour >= 13) {
      return { time: { hour, minute: 0 }, meridiemGiven: true };
    }
    if (eveningish && hour >= 1 && hour <= 11) hour += 12;
    if (hour <= 23) return { time: { hour, minute: 0 }, meridiemGiven: Boolean(dayPart) };
  }

  if (dayPart) {
    return { time: { hour: DAY_PART_HOURS[dayPart]!, minute: 0 }, meridiemGiven: true };
  }

  return { time: null, meridiemGiven: false };
}

function at(ctx: ResolveContext, base: ZonedParts, dayOffset: number, time: ClockTime | null): Date {
  return zonedTimeToUtc(
    ctx.timeZone,
    base.year,
    base.month,
    base.day + dayOffset,
    time?.hour ?? 0,
    time?.minute ?? 0,
  );
}

function resolved(instant: Date, allDay: boolean, phrase: string): Resolution {
  return { kind: "resolved", instant, allDay, phrase };
}

/**
 * Resolves one date phrase.
 *
 * Returns `unresolved` rather than guessing when nothing matches — the caller
 * keeps the original text and shows the item without a date, which is always
 * better than a wrong one.
 */
export function resolveDatePhrase(phraseRaw: string, ctx: ResolveContext): Resolution {
  const phrase = phraseRaw.trim();
  const text = phrase.toLowerCase();
  if (!text) return { kind: "unresolved", phrase };

  const today = partsInZone(ctx.now, ctx.timeZone);
  const { time, meridiemGiven } = extractTime(text);
  const hasTime = time !== null;

  // ── ISO passthrough ───────────────────────────────────────────────────────
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/.exec(text);
  if (iso) {
    const instant = zonedTimeToUtc(
      ctx.timeZone,
      Number(iso[1]),
      Number(iso[2]),
      Number(iso[3]),
      iso[4] ? Number(iso[4]) : (time?.hour ?? 0),
      iso[5] ? Number(iso[5]) : (time?.minute ?? 0),
    );
    return resolved(instant, !iso[4] && !hasTime, phrase);
  }

  // ── today / tonight / tomorrow / yesterday ────────────────────────────────
  if (/\btoday\b|\bthis (?:morning|afternoon|evening)\b/.test(text)) {
    return resolved(at(ctx, today, 0, time), !hasTime, phrase);
  }
  if (/\btonight\b/.test(text)) {
    return resolved(at(ctx, today, 0, time ?? { hour: DAY_PART_HOURS.tonight!, minute: 0 }), false, phrase);
  }
  if (/\btomorrow\b/.test(text)) {
    return resolved(at(ctx, today, 1, time), !hasTime, phrase);
  }
  if (/\byesterday\b/.test(text)) {
    return resolved(at(ctx, today, -1, time), !hasTime, phrase);
  }

  // ── in N days/weeks/months/years ──────────────────────────────────────────
  const relative =
    /\b(?:in|after)\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(day|week|month|year)s?\b/.exec(
      text,
    ) ??
    /\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(day|week|month|year)s?\s+from\s+now\b/.exec(
      text,
    );
  if (relative) {
    const raw = relative[1]!;
    const n = /^\d+$/.test(raw) ? Number(raw) : (NUMBER_WORDS[raw] ?? 1);
    const unit = relative[2];
    let instant: Date;
    if (unit === "day") instant = at(ctx, today, n, time);
    else if (unit === "week") instant = at(ctx, today, n * 7, time);
    else if (unit === "month") {
      instant = zonedTimeToUtc(
        ctx.timeZone,
        today.year,
        today.month + n,
        today.day,
        time?.hour ?? 0,
        time?.minute ?? 0,
      );
    } else {
      instant = zonedTimeToUtc(
        ctx.timeZone,
        today.year + n,
        today.month,
        today.day,
        time?.hour ?? 0,
        time?.minute ?? 0,
      );
    }
    return resolved(instant, !hasTime, phrase);
  }

  // ── weekdays ──────────────────────────────────────────────────────────────
  const weekdayMatch = /\b(this|next|coming|on)?\s*(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/.exec(
    text,
  );
  if (weekdayMatch) {
    const qualifier = weekdayMatch[1];
    const target = WEEKDAYS[weekdayMatch[2]!]!;
    // Days until the next occurrence, never today (0 -> 7).
    const ahead = ((target - today.weekday + 7) % 7) || 7;
    const soonest = at(ctx, today, ahead, time);
    const weekLater = at(ctx, today, ahead + 7, time);

    /*
     * "next Friday" is the one phrase English genuinely cannot agree on: half
     * of speakers mean the Friday that is coming, half mean the Friday of next
     * week. Guessing is a coin flip that silently corrupts a date, so this is
     * the canonical ambiguity — the UI asks.
     */
    if (qualifier === "next") {
      return {
        kind: "ambiguous",
        phrase,
        question: `Does “${phrase}” mean ${label(soonest, ctx.timeZone, !hasTime)} or ${label(
          weekLater,
          ctx.timeZone,
          !hasTime,
        )}?`,
        options: [
          { label: label(soonest, ctx.timeZone, !hasTime), instant: soonest, allDay: !hasTime },
          { label: label(weekLater, ctx.timeZone, !hasTime), instant: weekLater, allDay: !hasTime },
        ],
      };
    }

    return resolved(soonest, !hasTime, phrase);
  }

  // ── explicit calendar dates: "4 May", "May 4", "4 May 2028" ───────────────
  const explicit = parseExplicitDate(text);
  if (explicit) {
    const { day, month, year } = explicit;

    if (year) {
      return resolved(
        zonedTimeToUtc(ctx.timeZone, year, month, day, time?.hour ?? 0, time?.minute ?? 0),
        !hasTime,
        phrase,
      );
    }

    /*
     * No year given. Rolling forward to the next occurrence is the right
     * default for "my insurance renews on 4 May" — a due date is a future
     * fact. Calendar-date callers that need other readings (a birthday is a
     * past fact) go through `resolveCalendarPhrase`, which owns that choice.
     */
    const thisYear = zonedTimeToUtc(ctx.timeZone, today.year, month, day, time?.hour ?? 0, time?.minute ?? 0);
    const instant =
      thisYear.getTime() >= startOfDayInZone(ctx.now, ctx.timeZone).getTime()
        ? thisYear
        : zonedTimeToUtc(ctx.timeZone, today.year + 1, month, day, time?.hour ?? 0, time?.minute ?? 0);
    return resolved(instant, !hasTime, phrase);
  }

  // ── a bare time with no day means today, or tomorrow if it has passed ─────
  if (hasTime && meridiemGiven) {
    const todayAt = at(ctx, today, 0, time);
    if (todayAt.getTime() >= ctx.now.getTime()) return resolved(todayAt, false, phrase);
    return resolved(addDaysInZone(todayAt, 1, ctx.timeZone), false, phrase);
  }

  return { kind: "unresolved", phrase };
}

interface ExplicitDate {
  day: number;
  month: number;
  year: number | null;
}

/** "4 May", "May 4th, 1990", "22 September, 2019" → calendar parts, or null. */
function parseExplicitDate(text: string): ExplicitDate | null {
  // Both year groups tolerate the optional comma — "22 September, 2019" is
  // ordinary writing, and dropping its year silently stores the wrong date.
  const dayMonth = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)\b(?:,?\s+(\d{4}))?/.exec(text);
  const monthDay = /\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/.exec(text);

  const candidates: { day: string; month: string; year?: string }[] = [];
  if (dayMonth) candidates.push({ day: dayMonth[1]!, month: dayMonth[2]!, year: dayMonth[3] });
  if (monthDay) candidates.push({ day: monthDay[2]!, month: monthDay[1]!, year: monthDay[3] });

  for (const { day: dayRaw, month: monthRaw, year: yearRaw } of candidates) {
    const month = MONTHS[monthRaw.toLowerCase()];
    const day = Number(dayRaw);
    if (!month || !Number.isInteger(day) || day < 1 || day > 31) continue;
    return { day, month, year: yearRaw ? Number(yearRaw) : null };
  }
  return null;
}

/**
 * Which reading a year-less "4 May" gets, chosen by what kind of fact the
 * field holds. One resolver mode cannot serve all three:
 *
 * - `memory` — birthdays, anniversaries: the original year is simply unknown,
 *   so the date keeps the sentinel year and `yearKnown: false`. Rolling it
 *   forward would invent a year the user never said.
 * - `future` — expiry dates, one-off upcoming events: the next occurrence.
 * - `past` — issue dates: the most recent occurrence.
 */
export type CalendarDirection = "memory" | "future" | "past";

export type CalendarResolution =
  | { kind: "resolved"; isoDate: string; yearKnown: boolean; phrase: string }
  | { kind: "unresolved"; phrase: string };

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoOf(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Resolves a phrase into a *calendar date* — `YYYY-MM-DD`, no clock, no zone
 * on the value itself. This is what `important_date`, document dates and
 * person birthdays hold; the columns are Postgres `date`.
 *
 * There is deliberately no ambiguous variant here. Every calendar-date field
 * has a plain date input in its editor, so an unresolvable phrase leaves the
 * field empty with the phrase shown as provenance, and the typed date is the
 * answer path — the same rule that lets a typed due date answer a
 * `dateAmbiguity`. ("Next Friday" for a birthday is a phrase nobody writes;
 * the machinery to ask about it would outweigh the times it fires.)
 */
export function resolveCalendarPhrase(
  phraseRaw: string,
  ctx: ResolveContext,
  direction: CalendarDirection,
): CalendarResolution {
  const phrase = phraseRaw.trim();
  const text = phrase.toLowerCase();
  if (!text) return { kind: "unresolved", phrase };

  const explicit = parseExplicitDate(text);
  if (explicit) {
    const { day, month, year } = explicit;

    if (year) {
      if (day > daysInMonth(year, month)) return { kind: "unresolved", phrase };
      return { kind: "resolved", isoDate: isoOf(year, month, day), yearKnown: true, phrase };
    }

    if (direction === "memory") {
      // The sentinel is a leap year, so "February 29" survives.
      if (day > daysInMonth(UNKNOWN_YEAR_SENTINEL, month)) return { kind: "unresolved", phrase };
      return {
        kind: "resolved",
        isoDate: isoOf(UNKNOWN_YEAR_SENTINEL, month, day),
        yearKnown: false,
        phrase,
      };
    }

    const today = partsInZone(ctx.now, ctx.timeZone);
    const todayIso = isoDateInZone(ctx.now, ctx.timeZone);
    const step = direction === "future" ? 1 : -1;
    let year2 = today.year;
    if (direction === "future" && isoOf(year2, month, day) < todayIso) year2 += 1;
    if (direction === "past" && isoOf(year2, month, day) > todayIso) year2 -= 1;
    // "February 29" keeps walking to the nearest leap year in its direction —
    // the next/most recent occurrence is determinate, just not adjacent.
    // Eight steps covers even the century gap (2096 → 2104); anything still
    // invalid after that is an impossible date.
    for (let hops = 0; hops < 8 && day > daysInMonth(year2, month); hops += 1) {
      year2 += step;
    }
    if (day > daysInMonth(year2, month)) return { kind: "unresolved", phrase };
    return { kind: "resolved", isoDate: isoOf(year2, month, day), yearKnown: true, phrase };
  }

  /*
   * Not an explicit calendar date — "tomorrow", "in six months", "next
   * Tuesday". The instant resolver already handles these; its result is read
   * back as the local day it lands in. An ambiguous reading collapses to
   * unresolved here, per the note above.
   */
  const resolution = resolveDatePhrase(phrase, ctx);
  if (resolution.kind === "resolved") {
    return {
      kind: "resolved",
      isoDate: isoDateInZone(resolution.instant, ctx.timeZone),
      yearKnown: true,
      phrase,
    };
  }
  return { kind: "unresolved", phrase };
}

/**
 * Pulls a future-rolled instant back into the past, for fields that record
 * what HAPPENED — a vaccination "on 3 March" is last March, not next March
 * (review finding: the future-biased roll pushed past facts a year ahead).
 * Phrases that explicitly point forward are left alone, as is anything within
 * a day and a half — "tonight at 8" recorded in the afternoon is still today.
 */
export function biasInstantPast(instant: Date, phrase: string, ctx: ResolveContext): Date {
  const text = phrase.toLowerCase();
  if (/\b(tomorrow|next|coming|in\s+\w+|from\s+now)\b/.test(text)) return instant;
  if (instant.getTime() - ctx.now.getTime() <= 36 * 3_600_000) return instant;
  const p = partsInZone(instant, ctx.timeZone);
  const back = zonedTimeToUtc(ctx.timeZone, p.year - 1, p.month, p.day, p.hour, p.minute);
  return back.getTime() <= ctx.now.getTime() ? back : instant;
}

/**
 * Recurrence, restricted to what the app can actually honour. Returning null
 * for anything else is deliberate: an RRULE nothing evaluates is a lie in the
 * database.
 */
export function resolveRecurrence(phraseRaw: string): string | null {
  const text = phraseRaw.toLowerCase();
  if (/\bevery\s+year\b|\byearly\b|\bannually\b|\beach\s+year\b/.test(text)) return "FREQ=YEARLY";
  if (/\bevery\s+month\b|\bmonthly\b|\beach\s+month\b/.test(text)) return "FREQ=MONTHLY";
  if (/\bevery\s+week\b|\bweekly\b|\beach\s+week\b/.test(text)) return "FREQ=WEEKLY";
  if (/\bevery\s+day\b|\bdaily\b|\beach\s+day\b/.test(text)) return "FREQ=DAILY";
  // "every morning/evening/night" is a daily rule wearing its time of day.
  if (/\bevery\s+(morning|evening|night)\b/.test(text)) return "FREQ=DAILY";
  if (/\bevery\s+weekday\b|\bweekdays\b/.test(text)) return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
  const everyWeekday = /\bevery\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(text);
  if (everyWeekday) {
    const codes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
    return `FREQ=WEEKLY;BYDAY=${codes[WEEKDAYS[everyWeekday[1]!]!]}`;
  }
  return null;
}

/**
 * A phrase that repeats, resolved whole: the rule plus its first firing.
 *
 * Runs BEFORE `resolveDatePhrase` in normalisation, because "every Friday"
 * read as a one-off is the soonest Friday — right day, wrong meaning. The
 * first instant is today at the phrase's time when that is still ahead (and
 * lands on an allowed day), otherwise the rule's next occurrence.
 */
export function resolveRecurringPhrase(
  phraseRaw: string,
  ctx: ResolveContext,
): { rrule: string; firstInstant: Date; allDay: boolean } | null {
  const phrase = phraseRaw.trim();
  const text = phrase.toLowerCase();
  const rrule = resolveRecurrence(text);
  if (!rrule) return null;

  const rule = parseRrule(rrule);
  if (!rule) return null;

  const today = partsInZone(ctx.now, ctx.timeZone);
  const { time } = extractTime(text);
  const todayAt = zonedTimeToUtc(
    ctx.timeZone,
    today.year,
    today.month,
    today.day,
    time?.hour ?? 0,
    time?.minute ?? 0,
  );

  const todayAllowed = rule.byday.length === 0 || rule.byday.includes(today.weekday);
  const firstInstant =
    todayAt.getTime() > ctx.now.getTime() && todayAllowed
      ? todayAt
      : nextOccurrence(
          rrule,
          todayAt,
          new Date(Math.max(ctx.now.getTime(), todayAt.getTime())),
          ctx.timeZone,
        );

  if (!firstInstant) return null;

  /*
   * "for 10 days" bounds the course: the rule carries its own end, so the
   * last completion has no next occurrence and the item finishes for good —
   * a course of medication that stops nagging by itself, with nothing for
   * the user to clean up.
   */
  const bounded =
    /\bfor\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(day|week|month)s?\b/.exec(
      text,
    );
  if (bounded) {
    const raw = bounded[1]!;
    const n = /^\d+$/.test(raw) ? Number(raw) : (NUMBER_WORDS[raw] ?? 1);
    const unit = bounded[2]!;
    const days = unit === "day" ? n : unit === "week" ? n * 7 : n * 30;
    /*
     * Inclusive of the first firing's day: "for 10 days" starting tomorrow is
     * doses on days 1..10, so the bound sits just past the last one — counted
     * on the WALL CLOCK, not in raw milliseconds. A course crossing the
     * fall-back DST change is a wall-day longer than its millisecond span,
     * and the raw arithmetic dropped the final dose (confirmed in review).
     */
    const first = partsInZone(firstInstant, ctx.timeZone);
    const lastDose = zonedTimeToUtc(
      ctx.timeZone,
      first.year,
      first.month,
      first.day + (days - 1),
      first.hour,
      first.minute,
    );
    const until = new Date(lastDose.getTime() + 60_000);
    return {
      rrule: `${rrule};UNTIL=${formatUntil(until)}`,
      firstInstant,
      allDay: time === null,
    };
  }

  return { rrule, firstInstant, allDay: time === null };
}

/**
 * Offsets an instant backwards by a lead time ("two days before", "six months
 * before"), which is how reminders attached to a document are derived. Done in
 * code rather than by the model, which used to be asked to subtract dates.
 */
export function applyLeadTime(target: Date, phraseRaw: string, timeZone: string): Date | null {
  const text = phraseRaw.toLowerCase();
  const match =
    /\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(day|week|month|year)s?\s+(?:before|ahead|prior)\b/.exec(
      text,
    );
  if (!match) return null;

  const raw = match[1]!;
  const n = /^\d+$/.test(raw) ? Number(raw) : (NUMBER_WORDS[raw] ?? 1);
  const p = partsInZone(target, timeZone);
  const unit = match[2];

  // Reminders fire at 09:00 local unless the user said otherwise — an
  // all-day reminder at midnight is a notification nobody sees.
  const hour = 9;

  if (unit === "day") return zonedTimeToUtc(timeZone, p.year, p.month, p.day - n, hour);
  if (unit === "week") return zonedTimeToUtc(timeZone, p.year, p.month, p.day - n * 7, hour);
  if (unit === "month") return zonedTimeToUtc(timeZone, p.year, p.month - n, p.day, hour);
  return zonedTimeToUtc(timeZone, p.year - n, p.month, p.day, hour);
}
