/**
 * iCalendar (RFC 5545) serialisation for the published feed.
 *
 * Pure string work with an injected clock, for the same reason as
 * `src/lib/temporal`: the output has to be byte-for-byte predictable to be
 * testable, and a feed that a phone silently refuses to parse gives no error
 * anywhere — it just never appears in the calendar. Every rule below is one a
 * real client enforces.
 */

/** CRLF is not a style choice — RFC 5545 §3.1 requires it. */
const CRLF = "\r\n";

/** Content lines are folded at 75 *octets*, not characters. */
const MAX_LINE_OCTETS = 75;

/**
 * A timed event with no end is a zero-length instant, which some clients
 * render as nothing at all. Half an hour is a block a person can see.
 */
const TIMED_EVENT_MINUTES = 30;

/**
 * How often a subscribed client is asked to refresh. Advisory: iOS treats it
 * as a hint and Google ignores it outright, which is exactly why the settings
 * screen tells the user the feed is not instant.
 */
const REFRESH_INTERVAL = "PT6H";

export interface CalendarFeedEvent {
  /** Stable per row, so an edit updates an event instead of duplicating it. */
  uid: string;
  title: string;
  description?: string | null;
  /** `YYYY-MM-DD` for an all-day event, already resolved to the user's zone. */
  date?: string | null;
  /** ISO instant for a timed event. Ignored when `date` is set. */
  start?: string | null;
  /** Birthdays and anniversaries: the same day, every year. */
  yearly?: boolean | null;
  /** Which part of MeOS the event came from; emitted as CATEGORIES. */
  kind?: string | null;
}

export interface CalendarFeed {
  calendarName: string;
  timezone: string;
  events: CalendarFeedEvent[];
}

const encoder = new TextEncoder();

/**
 * Drops characters that are not valid in a TEXT value.
 *
 * A loop rather than a control-character regex: the regex form is both easy to
 * write wrongly and the kind of thing a linter argues with. Tab survives — it
 * is legal, and stripping it would mangle pasted text for no gain.
 */
function stripControlChars(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x7f || (code < 0x20 && char !== "\t")) continue;
    out += char;
  }
  return out;
}

/** Escapes the characters that mean something else inside a TEXT value. */
export function escapeIcsText(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    // Newlines become the literal two-character escape. Anything else in the
    // control range is one of the few things that makes a parser abandon the
    // entire calendar, so it goes.
    .replace(/\r\n|\r|\n/g, "\\n");
  return stripControlChars(escaped);
}

/**
 * Folds one content line to 75 octets, continuing with CRLF + a single space.
 *
 * Counted in UTF-8 bytes and split on whole code points: cutting a multi-byte
 * character in half produces a line no client will read, and a naive
 * `slice(75)` does exactly that on the first accented name.
 */
export function foldIcsLine(line: string): string {
  if (encoder.encode(line).length <= MAX_LINE_OCTETS) return line;

  const chunks: string[] = [];
  let current = "";
  let octets = 0;

  for (const char of line) {
    const size = encoder.encode(char).length;
    // Continuation lines spend one octet on the leading space.
    const limit = chunks.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1;
    if (octets + size > limit) {
      chunks.push(current);
      current = "";
      octets = 0;
    }
    current += char;
    octets += size;
  }
  chunks.push(current);

  return chunks.join(`${CRLF} `);
}

/** `20260811T043000Z` — the only date-time form that needs no VTIMEZONE. */
export function formatIcsUtc(instant: Date): string {
  return `${instant.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

/** `2026-09-22` → `20260922`. */
export function formatIcsDate(isoDate: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  return match ? `${match[1]}${match[2]}${match[3]}` : null;
}

/**
 * The day after, as `YYYYMMDD`.
 *
 * An all-day VEVENT's DTEND is *exclusive*: a one-day event ending on its own
 * start date is zero days long, and clients either drop it or draw it on the
 * wrong day. Built in UTC because these strings carry no zone at all.
 */
export function nextIcsDate(isoDate: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return null;
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
  return formatIcsDate(next.toISOString().slice(0, 10));
}

function eventLines(event: CalendarFeedEvent, stamp: string): string[] | null {
  const title = event.title?.trim() || "Untitled";
  const lines: string[] = [
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(event.uid)}@meos`,
    `DTSTAMP:${stamp}`,
  ];

  if (event.date) {
    const start = formatIcsDate(event.date);
    const end = nextIcsDate(event.date);
    if (!start || !end) return null;
    lines.push(`DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`);
    // An all-day marker should not make the user look busy for a whole day.
    lines.push("TRANSP:TRANSPARENT");
  } else if (event.start) {
    const instant = new Date(event.start);
    if (Number.isNaN(instant.getTime())) return null;
    const end = new Date(instant.getTime() + TIMED_EVENT_MINUTES * 60_000);
    lines.push(`DTSTART:${formatIcsUtc(instant)}`, `DTEND:${formatIcsUtc(end)}`);
  } else {
    // An event with no date is not an event. Dropped rather than emitted
    // broken, so one bad row cannot cost the user the whole feed.
    return null;
  }

  if (event.yearly) lines.push("RRULE:FREQ=YEARLY");
  lines.push(`SUMMARY:${escapeIcsText(title)}`);
  if (event.description?.trim()) {
    lines.push(`DESCRIPTION:${escapeIcsText(event.description.trim())}`);
  }
  if (event.kind?.trim()) lines.push(`CATEGORIES:${escapeIcsText(event.kind.trim())}`);
  lines.push("END:VEVENT");

  return lines;
}

/**
 * The whole calendar, ready to serve as `text/calendar`.
 *
 * `now` is passed rather than read so the same feed serialises identically in
 * a test as in production.
 */
export function buildIcsCalendar(feed: CalendarFeed, now: Date): string {
  const stamp = formatIcsUtc(now);

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MeOS//Calendar Feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `NAME:${escapeIcsText(feed.calendarName)}`,
    // The X- forms are what Apple and Google actually read; the standard
    // properties above are what everything else reads.
    `X-WR-CALNAME:${escapeIcsText(feed.calendarName)}`,
    `X-WR-TIMEZONE:${escapeIcsText(feed.timezone)}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${REFRESH_INTERVAL}`,
    `X-PUBLISHED-TTL:${REFRESH_INTERVAL}`,
  ];

  for (const event of feed.events) {
    const rendered = eventLines(event, stamp);
    if (rendered) lines.push(...rendered);
  }

  lines.push("END:VCALENDAR");

  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}
