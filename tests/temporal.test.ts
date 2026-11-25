import { describe, expect, it } from "vitest";
import {
  addDaysInZone,
  daysBetweenInZone,
  endOfDayInZone,
  isoDateInZone,
  partsInZone,
  startOfDayInZone,
  zonedTimeToUtc,
} from "@/lib/temporal/zone";
import { applyLeadTime, resolveDatePhrase, resolveRecurrence } from "@/lib/temporal/resolve";

/**
 * Fixed clock for every test in this file: Monday 10 August 2026, 18:30 in
 * Asia/Jerusalem (UTC+3 in summer). Nothing here calls `new Date()` without an
 * argument, so these tests never drift and never need a live AI call.
 */
const TZ = "Asia/Jerusalem";
const NOW = new Date("2026-08-10T15:30:00Z");
const ctx = { now: NOW, timeZone: TZ };

function localOf(instant: Date, timeZone = TZ): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);
}

describe("zone arithmetic", () => {
  it("reads wall-clock parts in the target zone, not the host zone", () => {
    const p = partsInZone(NOW, TZ);
    expect([p.year, p.month, p.day, p.hour, p.minute]).toEqual([2026, 8, 10, 18, 30]);
    expect(p.weekday).toBe(1); // Monday
  });

  it("puts the day boundary in the user's zone", () => {
    // 22:30 UTC on the 10th is already the 11th in Jerusalem.
    const lateEvening = new Date("2026-08-10T22:30:00Z");
    expect(isoDateInZone(lateEvening, TZ)).toBe("2026-08-11");
    expect(isoDateInZone(lateEvening, "UTC")).toBe("2026-08-10");
  });

  it("start and end of day bracket exactly one local day", () => {
    const start = startOfDayInZone(NOW, TZ);
    const end = endOfDayInZone(NOW, TZ);
    expect(localOf(start)).toBe("10/08/2026, 00:00");
    expect(end.getTime() - start.getTime()).toBe(86_400_000 - 1);
  });

  it("adds calendar days across a DST transition without drifting an hour", () => {
    // Europe/London leaves BST at 02:00 on 25 October 2026.
    const beforeChange = zonedTimeToUtc("Europe/London", 2026, 10, 24, 12, 0);
    const nextDay = addDaysInZone(beforeChange, 2, "Europe/London");
    expect(localOf(nextDay, "Europe/London")).toBe("26/10/2026, 12:00");
  });

  it("counts whole calendar days, not 24-hour blocks", () => {
    const late = new Date("2026-08-10T20:30:00Z"); // 23:30 local, still the 10th
    const early = new Date("2026-08-11T02:30:00Z"); // 05:30 local on the 11th
    expect(daysBetweenInZone(late, early, TZ)).toBe(1);
  });
});

describe("relative date phrases", () => {
  it("resolves 'today' to the local day, all-day", () => {
    const r = resolveDatePhrase("today", ctx);
    expect(r.kind).toBe("resolved");
    if (r.kind !== "resolved") return;
    expect(isoDateInZone(r.instant, TZ)).toBe("2026-08-10");
    expect(r.allDay).toBe(true);
  });

  it("resolves 'tomorrow'", () => {
    const r = resolveDatePhrase("tomorrow", ctx);
    expect(r.kind === "resolved" && isoDateInZone(r.instant, TZ)).toBe("2026-08-11");
  });

  it("attaches a clock time when one is given", () => {
    const r = resolveDatePhrase("tomorrow at 18:30", ctx);
    expect(r.kind).toBe("resolved");
    if (r.kind !== "resolved") return;
    expect(localOf(r.instant)).toBe("11/08/2026, 18:30");
    expect(r.allDay).toBe(false);
  });

  it("gives 'tonight' an evening default rather than midnight", () => {
    const r = resolveDatePhrase("tonight", ctx);
    expect(r.kind === "resolved" && localOf(r.instant)).toBe("10/08/2026, 20:00");
  });

  it("resolves 'in two weeks' from the local day", () => {
    const r = resolveDatePhrase("in two weeks", ctx);
    expect(r.kind === "resolved" && isoDateInZone(r.instant, TZ)).toBe("2026-08-24");
  });

  it("resolves 'in 6 months'", () => {
    const r = resolveDatePhrase("in 6 months", ctx);
    expect(r.kind === "resolved" && isoDateInZone(r.instant, TZ)).toBe("2027-02-10");
  });

  it("resolves an unqualified weekday to the soonest one, never today", () => {
    const r = resolveDatePhrase("on Friday", ctx);
    expect(r.kind === "resolved" && isoDateInZone(r.instant, TZ)).toBe("2026-08-14");
  });

  it("refuses to guess what 'next Friday' means", () => {
    const r = resolveDatePhrase("next Friday", ctx);
    expect(r.kind).toBe("ambiguous");
    if (r.kind !== "ambiguous") return;
    expect(r.options.map((o) => isoDateInZone(o.instant, TZ))).toEqual([
      "2026-08-14",
      "2026-08-21",
    ]);
    // The question must name the actual dates, not say "worth a check".
    expect(r.question).toContain("14 Aug");
    expect(r.question).toContain("21 Aug");
  });

  it("rolls a bare day-and-month forward to its next occurrence", () => {
    // 4 May has already passed in 2026.
    const r = resolveDatePhrase("4 May", ctx);
    expect(r.kind === "resolved" && isoDateInZone(r.instant, TZ)).toBe("2027-05-04");
  });

  it("keeps an explicit year exactly as written", () => {
    const r = resolveDatePhrase("14 May 2028", ctx);
    expect(r.kind === "resolved" && isoDateInZone(r.instant, TZ)).toBe("2028-05-14");
  });

  it("accepts ISO dates unchanged", () => {
    const r = resolveDatePhrase("2026-12-25", ctx);
    expect(r.kind === "resolved" && isoDateInZone(r.instant, TZ)).toBe("2026-12-25");
  });

  it("moves a bare past time to tomorrow", () => {
    // 09:00 has already gone by 18:30 local.
    const r = resolveDatePhrase("9am", ctx);
    expect(r.kind === "resolved" && localOf(r.instant)).toBe("11/08/2026, 09:00");
  });

  it("returns unresolved instead of inventing a date", () => {
    expect(resolveDatePhrase("sometime soon", ctx).kind).toBe("unresolved");
    expect(resolveDatePhrase("", ctx).kind).toBe("unresolved");
  });
});

describe("recurrence", () => {
  it("maps the phrasings the app can actually honour", () => {
    expect(resolveRecurrence("every year on 4 May")).toBe("FREQ=YEARLY");
    expect(resolveRecurrence("monthly")).toBe("FREQ=MONTHLY");
    expect(resolveRecurrence("every Tuesday")).toBe("FREQ=WEEKLY;BYDAY=TU");
    expect(resolveRecurrence("daily")).toBe("FREQ=DAILY");
  });

  it("returns null rather than storing a rule nothing evaluates", () => {
    expect(resolveRecurrence("every other Thursday in leap years")).toBeNull();
    expect(resolveRecurrence("often")).toBeNull();
  });
});

describe("lead time", () => {
  const passportExpiry = zonedTimeToUtc(TZ, 2028, 5, 14);

  it("subtracts a lead time in code rather than asking the model to", () => {
    const r = applyLeadTime(passportExpiry, "remind me six months before", TZ);
    expect(r && localOf(r)).toBe("14/11/2027, 09:00");
  });

  it("handles days", () => {
    const r = applyLeadTime(passportExpiry, "two days before", TZ);
    expect(r && localOf(r)).toBe("12/05/2028, 09:00");
  });

  it("returns null when there is no lead-time phrase", () => {
    expect(applyLeadTime(passportExpiry, "remind me", TZ)).toBeNull();
  });
});
