import { describe, expect, it } from "vitest";
import {
  buildIcsCalendar,
  escapeIcsText,
  foldIcsLine,
  formatIcsUtc,
  nextIcsDate,
  type CalendarFeedEvent,
} from "@/lib/calendar/ics";

/**
 * §6.3 E. A calendar client that dislikes the feed reports nothing — the
 * subscription simply stays empty — so every rule RFC 5545 imposes is pinned
 * here rather than discovered on a phone.
 */

const NOW = new Date("2026-08-11T04:00:00.000Z");

function build(events: CalendarFeedEvent[]): string {
  return buildIcsCalendar(
    { calendarName: "MeOS — Jeries", timezone: "Asia/Jerusalem", events },
    NOW,
  );
}

/** Content lines, unfolded, the way a parser reads them. */
function lines(ics: string): string[] {
  return ics.replace(/\r\n /g, "").split("\r\n").filter(Boolean);
}

describe("TEXT escaping", () => {
  it("escapes the characters that would otherwise end the value", () => {
    expect(escapeIcsText("Milk, bread; and a \\ backslash")).toBe(
      "Milk\\, bread\\; and a \\\\ backslash",
    );
  });

  it("turns real newlines into the two-character escape", () => {
    expect(escapeIcsText("first\nsecond")).toBe("first\\nsecond");
    expect(escapeIcsText("first\r\nsecond")).toBe("first\\nsecond");
  });

  it("strips control characters a parser would choke on, but keeps tabs", () => {
    expect(escapeIcsText("clean\u0007text")).toBe("cleantext");
    expect(escapeIcsText("a\tb")).toBe("a\tb");
  });
});

describe("line folding", () => {
  const long = `SUMMARY:${"a".repeat(200)}`;

  it("keeps every physical line inside 75 octets", () => {
    for (const line of foldIcsLine(long).split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("unfolds back to exactly what went in", () => {
    expect(foldIcsLine(long).replace(/\r\n /g, "")).toBe(long);
  });

  it("never splits a multi-byte character in half", () => {
    // Emoji are four octets: a byte-wise slice at 75 lands inside one and
    // produces a line the client discards along with the event.
    const emoji = `SUMMARY:${"🎂".repeat(40)}`;
    const folded = foldIcsLine(emoji);
    expect(folded.replace(/\r\n /g, "")).toBe(emoji);
    expect(folded).not.toContain("�");
  });

  it("leaves a short line alone", () => {
    expect(foldIcsLine("VERSION:2.0")).toBe("VERSION:2.0");
  });
});

describe("a birthday", () => {
  const ics = build([
    { uid: "birthday-1", title: "Birthday — Dana", date: "2026-09-22", yearly: true, kind: "birthday" },
  ]);

  it("is an all-day event that repeats every year", () => {
    expect(lines(ics)).toEqual(
      expect.arrayContaining([
        "DTSTART;VALUE=DATE:20260922",
        "RRULE:FREQ=YEARLY",
        "SUMMARY:Birthday — Dana",
        "CATEGORIES:birthday",
      ]),
    );
  });

  it("ends on the following day, because DTEND is exclusive", () => {
    // A one-day event ending on its own start date is zero days long, and
    // clients either drop it or draw it on the wrong day.
    expect(lines(ics)).toContain("DTEND;VALUE=DATE:20260923");
  });

  it("does not make the user look busy all day", () => {
    expect(lines(ics)).toContain("TRANSP:TRANSPARENT");
  });
});

describe("a timed item", () => {
  const ics = build([{ uid: "item-9", title: "Wake up", start: "2026-08-11T04:00:00+00:00", kind: "alarm" }]);

  it("is written as a UTC instant, so no VTIMEZONE is needed", () => {
    expect(lines(ics)).toContain("DTSTART:20260811T040000Z");
  });

  it("gets a visible half-hour block rather than zero length", () => {
    expect(lines(ics)).toContain("DTEND:20260811T043000Z");
  });

  it("carries no RRULE", () => {
    expect(ics).not.toContain("RRULE");
  });
});

describe("the calendar as a whole", () => {
  it("wraps the events and names itself", () => {
    const ics = build([{ uid: "a", title: "One", date: "2026-01-01" }]);
    const content = lines(ics);
    expect(content[0]).toBe("BEGIN:VCALENDAR");
    expect(content.at(-1)).toBe("END:VCALENDAR");
    expect(content).toEqual(
      expect.arrayContaining([
        "VERSION:2.0",
        "X-WR-CALNAME:MeOS — Jeries",
        "X-WR-TIMEZONE:Asia/Jerusalem",
      ]),
    );
  });

  it("ends every line with CRLF, including the last", () => {
    const ics = build([{ uid: "a", title: "One", date: "2026-01-01" }]);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.split("\n").every((line) => line === "" || line.endsWith("\r"))).toBe(true);
  });

  it("stamps every event with the clock it was passed", () => {
    const ics = build([{ uid: "a", title: "One", date: "2026-01-01" }]);
    expect(ics).toContain(`DTSTAMP:${formatIcsUtc(NOW)}`);
  });

  it("drops a dateless or unparsable row instead of serving a broken feed", () => {
    const ics = build([
      { uid: "good", title: "Kept", date: "2026-01-01" },
      { uid: "no-date", title: "Dropped" },
      { uid: "bad-date", title: "Also dropped", date: "the fourteenth" },
      { uid: "bad-instant", title: "Dropped too", start: "soon" },
    ]);
    expect(ics).toContain("SUMMARY:Kept");
    expect(ics).not.toContain("Dropped");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it("gives an untitled row a summary rather than an empty one", () => {
    expect(build([{ uid: "a", title: "  ", date: "2026-01-01" }])).toContain("SUMMARY:Untitled");
  });

  it("keeps UIDs stable so a re-fetch updates rather than duplicates", () => {
    expect(build([{ uid: "item-42", title: "One", date: "2026-01-01" }])).toContain(
      "UID:item-42@meos",
    );
  });
});

describe("day arithmetic", () => {
  it("rolls over month and year ends", () => {
    expect(nextIcsDate("2026-01-31")).toBe("20260201");
    expect(nextIcsDate("2026-12-31")).toBe("20270101");
    // 2028 is a leap year: the day after 28 Feb is the 29th, not 1 March.
    expect(nextIcsDate("2028-02-28")).toBe("20280229");
  });

  it("returns null for anything that isn't a full ISO date", () => {
    expect(nextIcsDate("nope")).toBeNull();
    expect(nextIcsDate("2026-9-1")).toBeNull();
    expect(nextIcsDate("2026-08-11T07:00:00Z")).toBeNull();
  });
});
