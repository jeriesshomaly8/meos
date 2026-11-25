import { describe, expect, it } from "vitest";
import {
  advancedDueAt,
  describeRrule,
  nextOccurrence,
  parseRrule,
} from "@/lib/temporal/recurrence";
import { resolveRecurringPhrase } from "@/lib/temporal/resolve";
import { parseExtractionResponse } from "@/lib/extraction/schema";
import { normaliseProposals } from "@/lib/extraction/normalise";
import { missingRequirementOf } from "@/lib/extraction/ambiguity";
import { buildRpcItems } from "@/lib/extraction/to-rpc";
import { isoDateInZone, partsInZone } from "@/lib/temporal/zone";

/**
 * Recurring tasks and alarms (§v2.1). The one rule everything here defends:
 * a repeating 07:00 is 07:00 on the user's wall regardless of DST, and
 * "done" means done with this round — never a backlog of missed rounds to
 * clear one tap at a time.
 */

const TZ = "Asia/Jerusalem";
const NOW = new Date("2026-08-10T15:30:00Z"); // Mon 10 Aug, 18:30 local (UTC+3)
const ctx = { now: NOW, timeZone: TZ };

describe("parseRrule", () => {
  it("reads the dialect and nothing else", () => {
    expect(parseRrule("FREQ=DAILY")).toEqual({ freq: "DAILY", byday: [], until: null });
    expect(parseRrule("FREQ=WEEKLY;BYDAY=MO,TH")).toEqual({
      freq: "WEEKLY",
      byday: [1, 4],
      until: null,
    });
    expect(parseRrule("FREQ=HOURLY")).toBeNull();
    expect(parseRrule("FREQ=WEEKLY;BYDAY=XX")).toBeNull();
  });
});

describe("nextOccurrence", () => {
  const anchor = new Date("2026-08-11T04:00:00Z"); // Tue 11 Aug, 07:00 local

  it("daily: the next day at the same wall-clock time", () => {
    const next = nextOccurrence("FREQ=DAILY", anchor, anchor, TZ)!;
    expect(isoDateInZone(next, TZ)).toBe("2026-08-12");
    expect(partsInZone(next, TZ).hour).toBe(7);
  });

  it("daily: 07:00 stays 07:00 across the DST fall-back", () => {
    // Israel leaves DST on 25 Oct 2026 — the UTC offset changes, the wall
    // clock must not.
    const beforeShift = new Date("2026-10-24T04:00:00Z"); // Sat, 07:00 IDT
    const next = nextOccurrence("FREQ=DAILY", beforeShift, beforeShift, TZ)!;
    expect(isoDateInZone(next, TZ)).toBe("2026-10-25");
    expect(partsInZone(next, TZ).hour).toBe(7);
    expect(next.toISOString()).toBe("2026-10-25T05:00:00.000Z"); // now IST
  });

  it("weekdays: Friday advances to Monday, skipping the weekend", () => {
    const friday = new Date("2026-08-14T04:00:00Z"); // Fri, 07:00 local
    const next = nextOccurrence("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", friday, friday, TZ)!;
    expect(isoDateInZone(next, TZ)).toBe("2026-08-17"); // Monday
  });

  it("monthly on the 31st: months without one are skipped, not clamped", () => {
    const jan31 = new Date("2027-01-31T07:00:00Z");
    const next = nextOccurrence("FREQ=MONTHLY", jan31, jan31, TZ)!;
    expect(isoDateInZone(next, TZ)).toBe("2027-03-31");
  });

  it("yearly on Feb 29 lands on the next leap year", () => {
    const feb29 = new Date("2028-02-29T07:00:00Z");
    const next = nextOccurrence("FREQ=YEARLY", feb29, feb29, TZ)!;
    expect(isoDateInZone(next, TZ)).toBe("2032-02-29");
  });
});

describe("advancedDueAt — what 'done' does to a repeating item", () => {
  it("ticking today's round moves to the next one", () => {
    const dueAt = new Date("2026-08-10T04:00:00Z"); // this morning, 07:00
    const next = advancedDueAt("FREQ=DAILY", dueAt, NOW, TZ)!;
    expect(isoDateInZone(next, TZ)).toBe("2026-08-11");
  });

  it("ticking Monday's round on Wednesday lands on Thursday — no backlog", () => {
    const monday = new Date("2026-08-10T04:00:00Z");
    const wednesday = new Date("2026-08-12T15:00:00Z");
    const next = advancedDueAt("FREQ=DAILY", monday, wednesday, TZ)!;
    expect(isoDateInZone(next, TZ)).toBe("2026-08-13");
  });

  it("refuses to advance a rule outside the dialect", () => {
    expect(advancedDueAt("FREQ=HOURLY", NOW, NOW, TZ)).toBeNull();
  });
});

describe("resolveRecurringPhrase", () => {
  it("“every weekday at 7” from a Monday evening first fires Tuesday 07:00", () => {
    const r = resolveRecurringPhrase("every weekday at 7", ctx)!;
    expect(r.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(isoDateInZone(r.firstInstant, TZ)).toBe("2026-08-11");
    expect(partsInZone(r.firstInstant, TZ).hour).toBe(7);
    expect(r.allDay).toBe(false);
  });

  it("“every evening at 8” fires tonight — 20:00 is still ahead of 18:30", () => {
    const r = resolveRecurringPhrase("every evening at 8pm", ctx)!;
    expect(isoDateInZone(r.firstInstant, TZ)).toBe("2026-08-10");
    expect(partsInZone(r.firstInstant, TZ).hour).toBe(20);
  });

  it("“every evening at 8” needs no pm — the word evening already said it", () => {
    // The regression: the bare 'at 8' used to win over the day-part word and
    // arm 08:00.
    const r = resolveRecurringPhrase("every evening at 8", ctx)!;
    expect(partsInZone(r.firstInstant, TZ).hour).toBe(20);
  });

  it("a 24-hour clock time is unambiguous without am/pm", () => {
    // "at 19:30" resolved to nothing because the parser demanded a meridiem.
    const r = resolveRecurringPhrase("every day at 19:30", ctx)!;
    expect(partsInZone(r.firstInstant, TZ).hour).toBe(19);
    expect(partsInZone(r.firstInstant, TZ).minute).toBe(30);
    expect(r.allDay).toBe(false);
  });

  it("“every monday” names the day but no time", () => {
    const r = resolveRecurringPhrase("every monday", ctx)!;
    expect(r.rrule).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(isoDateInZone(r.firstInstant, TZ)).toBe("2026-08-17");
    expect(r.allDay).toBe(true);
  });

  it("returns null for phrases that don't repeat", () => {
    expect(resolveRecurringPhrase("tomorrow at 7", ctx)).toBeNull();
  });
});

describe("through the pipeline", () => {
  function alarm(datePhrase: string) {
    return {
      items: [
        {
          temporaryId: "a1",
          category: "alarm",
          action: "create",
          confidence: 0.95,
          summary: "Wake up",
          relationships: [],
          missingFields: [],
          sourceText: `wake me ${datePhrase}`,
          structuredData: { title: "Wake up", datePhrase },
        },
      ],
    };
  }

  it("“wake me every weekday at 7” stores the rule and the first firing", () => {
    const { items } = parseExtractionResponse(alarm("every weekday at 7"));
    const normalised = normaliseProposals(items, ctx);
    const rpc = buildRpcItems(normalised.items.map((item) => ({ item, existingPersonId: null })));
    expect(rpc[0]!.data.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(isoDateInZone(new Date(rpc[0]!.data.due_at as string), TZ)).toBe("2026-08-11");
    expect(missingRequirementOf(normalised.items[0]!)).toBeNull();
  });

  it("a recurring alarm with no clock time is still blocked until it has one", () => {
    const { items } = parseExtractionResponse(alarm("every monday"));
    const normalised = normaliseProposals(items, ctx);
    expect(missingRequirementOf(normalised.items[0]!)).toBe("Set the time this should ring.");
  });
});

describe("describeRrule", () => {
  it("reads the way a person would say it", () => {
    expect(describeRrule("FREQ=DAILY")).toBe("every day");
    expect(describeRrule("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR")).toBe("every weekday");
    expect(describeRrule("FREQ=WEEKLY;BYDAY=MO,TH")).toBe("every Monday and Thursday");
    expect(describeRrule("FREQ=NOPE")).toBeNull();
  });
});
