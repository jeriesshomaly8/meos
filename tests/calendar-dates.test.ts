import { describe, expect, it } from "vitest";
import { resolveCalendarPhrase } from "@/lib/temporal/resolve";
import { parseExtractionResponse } from "@/lib/extraction/schema";
import { normaliseProposals } from "@/lib/extraction/normalise";
import { importantDateRequirement, missingRequirementOf } from "@/lib/extraction/ambiguity";
import { buildRpcItems } from "@/lib/extraction/to-rpc";
import { UNKNOWN_YEAR_SENTINEL } from "@/lib/dates";

/**
 * The last three categories off the model's date arithmetic (§Phase 3):
 * important_date, document dates and person birthdays hold *calendar dates* —
 * Postgres `date`, a `yearKnown` sentinel, no clock — and the model now
 * reports the phrase it saw while `resolveCalendarPhrase` decides what a
 * year-less "4 May" means per field. No API call anywhere in this file.
 */

const TZ = "Asia/Jerusalem";
const NOW = new Date("2026-08-10T15:30:00Z"); // Mon 10 Aug, 18:30 local
const ctx = { now: NOW, timeZone: TZ };

function proposal(category: string, structuredData: Record<string, unknown>, extra = {}) {
  return {
    items: [
      {
        temporaryId: "c1",
        category,
        action: "create",
        confidence: 0.95,
        summary: "s",
        relationships: [],
        missingFields: [],
        sourceText: "t",
        structuredData,
        ...extra,
      },
    ],
  };
}

function run(raw: unknown) {
  const { items } = parseExtractionResponse(raw);
  const normalised = normaliseProposals(items, ctx);
  const rpc = buildRpcItems(normalised.items.map((item) => ({ item, existingPersonId: null })));
  return { items: normalised.items, rpc };
}

const person = (birthdayPhrase: string | null) =>
  proposal("person", {
    name: "Dana",
    relationship: null,
    birthdayPhrase,
    notes: null,
    generalPreferences: [],
  });

const importantDate = (datePhrase: string | null, recurrence: "none" | "yearly") =>
  proposal("important_date", {
    title: "Wedding",
    datePhrase,
    recurrence,
    personRef: null,
    notes: null,
  });

const document = (expiryPhrase: string | null, issuePhrase: string | null) =>
  proposal("document", {
    documentType: "passport",
    displayName: "Passport",
    documentNumber: null,
    issuePhrase,
    expiryPhrase,
    issuingCountry: null,
    notes: null,
  });

describe("resolveCalendarPhrase directions", () => {
  it("memory: a year-less date keeps the sentinel year, because rolling forward invents a year", () => {
    const r = resolveCalendarPhrase("May 4", ctx, "memory");
    expect(r).toMatchObject({ kind: "resolved", isoDate: "2000-05-04", yearKnown: false });
  });

  it("memory: a stated year is kept and believed", () => {
    const r = resolveCalendarPhrase("4 May 1990", ctx, "memory");
    expect(r).toMatchObject({ kind: "resolved", isoDate: "1990-05-04", yearKnown: true });
  });

  it("future: a year-less date is its next occurrence", () => {
    // 4 May has passed by 10 Aug, so the next one is 2027's.
    const r = resolveCalendarPhrase("4 May", ctx, "future");
    expect(r).toMatchObject({ kind: "resolved", isoDate: "2027-05-04", yearKnown: true });
    // 22 September has not — this year's.
    const ahead = resolveCalendarPhrase("September 22", ctx, "future");
    expect(ahead).toMatchObject({ kind: "resolved", isoDate: "2026-09-22" });
  });

  it("past: a year-less date is its most recent occurrence", () => {
    const r = resolveCalendarPhrase("3 March", ctx, "past");
    expect(r).toMatchObject({ kind: "resolved", isoDate: "2026-03-03" });
    const behind = resolveCalendarPhrase("September 22", ctx, "past");
    expect(behind).toMatchObject({ kind: "resolved", isoDate: "2025-09-22" });
  });

  it("relative phrases resolve through the instant path, as the user's local day", () => {
    // Jerusalem evening: "tomorrow" must be the 11th there, not the server's day.
    const r = resolveCalendarPhrase("tomorrow", ctx, "future");
    expect(r).toMatchObject({ kind: "resolved", isoDate: "2026-08-11", yearKnown: true });
    const months = resolveCalendarPhrase("in six months", ctx, "future");
    expect(months).toMatchObject({ kind: "resolved", isoDate: "2027-02-10" });
  });

  it("the sentinel year is a leap year, so February 29 survives", () => {
    const r = resolveCalendarPhrase("February 29", ctx, "memory");
    expect(r).toMatchObject({ kind: "resolved", isoDate: `${UNKNOWN_YEAR_SENTINEL}-02-29` });
  });

  it("February 29 walks to the nearest leap year in its direction", () => {
    // From Aug 2026: the next Feb 29 is 2028, the most recent was 2024.
    expect(resolveCalendarPhrase("February 29", ctx, "future")).toMatchObject({
      isoDate: "2028-02-29",
    });
    expect(resolveCalendarPhrase("February 29", ctx, "past")).toMatchObject({
      isoDate: "2024-02-29",
    });
  });

  it("keeps a comma-separated year in day-first writing — '22 September, 2019'", () => {
    // The regression: dayMonth's year group lacked the optional comma that
    // monthDay had, so the stated year was silently dropped.
    expect(resolveCalendarPhrase("22 September, 2019", ctx, "past")).toMatchObject({
      isoDate: "2019-09-22",
      yearKnown: true,
    });
    expect(resolveCalendarPhrase("4 May, 1990", ctx, "memory")).toMatchObject({
      isoDate: "1990-05-04",
      yearKnown: true,
    });
  });

  it("refuses impossible and unplaceable dates instead of guessing", () => {
    expect(resolveCalendarPhrase("31 February", ctx, "memory").kind).toBe("unresolved");
    expect(resolveCalendarPhrase("sometime in spring", ctx, "future").kind).toBe("unresolved");
    expect(resolveCalendarPhrase("", ctx, "memory").kind).toBe("unresolved");
  });

  it("an ambiguous phrase collapses to unresolved — the editor's date input is the answer path", () => {
    expect(resolveCalendarPhrase("next Friday", ctx, "future").kind).toBe("unresolved");
  });
});

describe("“Dana's birthday is May 4”", () => {
  const { rpc } = run(person("May 4"));

  it("stores the sentinel year and remembers the year is unknown", () => {
    expect(rpc[0]!.data.birthday).toBe("2000-05-04");
    expect(rpc[0]!.data.birthday_year_known).toBe(false);
  });
});

describe("“Dana was born 4 May 1990”", () => {
  const { rpc } = run(person("4 May 1990"));

  it("keeps the stated year", () => {
    expect(rpc[0]!.data.birthday).toBe("1990-05-04");
    expect(rpc[0]!.data.birthday_year_known).toBe(true);
  });
});

describe("a person with no birthday mentioned", () => {
  const { items, rpc } = run(person(null));

  it("stays savable with nothing invented", () => {
    expect(rpc[0]!.data.birthday).toBeNull();
    expect(missingRequirementOf(items[0]!)).toBeNull();
  });
});

describe("“our anniversary is June 12” (yearly)", () => {
  const { items, rpc } = run(importantDate("June 12", "yearly"));

  it("is a memory: sentinel year, year unknown", () => {
    expect(rpc[0]!.data.event_date).toBe("2000-06-12");
    expect(rpc[0]!.data.year_known).toBe(false);
    expect(missingRequirementOf(items[0]!)).toBeNull();
  });
});

describe("“the wedding is on 4 May” (one-off)", () => {
  const { rpc } = run(importantDate("4 May", "none"));

  it("is an upcoming event: the next 4 May, year known", () => {
    expect(rpc[0]!.data.event_date).toBe("2027-05-04");
    expect(rpc[0]!.data.year_known).toBe(true);
  });
});

describe("an important date whose phrase cannot be placed", () => {
  const { items } = run(importantDate("sometime in spring", "none"));

  it("blocks the save with a sentence naming what to do, because event_date is NOT NULL", () => {
    expect(missingRequirementOf(items[0]!)).toBe("Pick the date this falls on.");
  });

  it("shares the sentence with the editor's inline message", () => {
    const item = items[0]!;
    if (item.category !== "important_date") throw new Error("wrong category");
    expect(importantDateRequirement(item.structuredData)).toBe("Pick the date this falls on.");
  });
});

describe("“passport expires 3 March, issued March 2019”", () => {
  const { rpc } = run(document("3 March", null));

  it("reads an expiry forward: the next 3 March", () => {
    expect(rpc[0]!.data.expiration_date).toBe("2027-03-03");
  });
});

describe("“issued on 22 September”", () => {
  const { rpc } = run(document(null, "22 September"));

  it("reads an issue date backward: the most recent 22 September", () => {
    expect(rpc[0]!.data.issue_date).toBe("2025-09-22");
  });
});

describe("“expires in six months”", () => {
  const { rpc } = run(document("in six months", null));

  it("resolves relative phrases against the user's clock and zone", () => {
    expect(rpc[0]!.data.expiration_date).toBe("2027-02-10");
  });
});

describe("a document with no dates mentioned", () => {
  const { items, rpc } = run(document(null, null));

  it("stays savable — document dates are nullable", () => {
    expect(rpc[0]!.data.expiration_date).toBeNull();
    expect(rpc[0]!.data.issue_date).toBeNull();
    expect(missingRequirementOf(items[0]!)).toBeNull();
  });
});
