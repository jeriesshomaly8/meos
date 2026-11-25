import { describe, expect, it } from "vitest";
import {
  fromDateInput,
  fromDateTimeInput,
  setAllDay,
  toDateInput,
  toDateTimeInput,
} from "@/lib/temporal/inputs";
import { isoDateInZone } from "@/lib/temporal/zone";

/**
 * Date inputs hand back "2026-08-14" and take it back the same way. The naive
 * conversion — `new Date(value)` — reads that as UTC midnight, so every user
 * west of Greenwich would see the day they typed shift backwards by one. These
 * tests exist to keep that specific bug from coming back.
 */

const WEST = "America/New_York"; // UTC-4 in August, UTC-5 in March
const EAST = "Asia/Jerusalem"; // UTC+3 in August

describe("all-day dates through a date input", () => {
  it("stores the day the user typed, at that day's local midnight", () => {
    expect(fromDateInput("2026-08-14", EAST)).toBe("2026-08-13T21:00:00.000Z");
    expect(fromDateInput("2026-08-14", WEST)).toBe("2026-08-14T04:00:00.000Z");
  });

  it("round-trips in both hemispheres of the prime meridian", () => {
    for (const zone of [WEST, EAST, "UTC", "Pacific/Auckland"]) {
      const stored = fromDateInput("2026-08-14", zone)!;
      expect(toDateInput(stored, zone)).toBe("2026-08-14");
    }
  });

  it("does not repeat the UTC-midnight mistake", () => {
    // What the obvious implementation would have produced.
    const naive = new Date("2026-08-14").toISOString();
    expect(toDateInput(naive, WEST)).toBe("2026-08-13");
    expect(toDateInput(fromDateInput("2026-08-14", WEST), WEST)).toBe("2026-08-14");
  });

  it("survives the day the clocks go forward", () => {
    const stored = fromDateInput("2026-03-08", WEST)!; // DST starts this day
    expect(isoDateInZone(new Date(stored), WEST)).toBe("2026-03-08");
    expect(toDateInput(stored, WEST)).toBe("2026-03-08");
  });

  it("treats an empty or half-typed field as no date", () => {
    expect(fromDateInput("", EAST)).toBeNull();
    expect(fromDateInput("2026-08", EAST)).toBeNull();
    expect(toDateInput(null, EAST)).toBe("");
    expect(toDateInput("not a date", EAST)).toBe("");
  });
});

describe("timed dates through a datetime-local input", () => {
  it("round-trips the wall clock the user sees", () => {
    for (const zone of [WEST, EAST, "UTC"]) {
      const stored = fromDateTimeInput("2026-08-14T18:30", zone)!;
      expect(toDateTimeInput(stored, zone)).toBe("2026-08-14T18:30");
    }
  });

  it("resolves the wall clock against the zone, not the server", () => {
    expect(fromDateTimeInput("2026-08-14T18:30", EAST)).toBe("2026-08-14T15:30:00.000Z");
    expect(fromDateTimeInput("2026-08-14T18:30", WEST)).toBe("2026-08-14T22:30:00.000Z");
  });

  it("treats an empty field as no date", () => {
    expect(fromDateTimeInput("", EAST)).toBeNull();
    expect(toDateTimeInput(null, EAST)).toBe("");
  });
});

describe("toggling all day", () => {
  it("keeps the day when a time is dropped", () => {
    const timed = fromDateTimeInput("2026-08-14T18:30", EAST)!;
    const allDay = setAllDay(timed, true, EAST)!;
    expect(toDateInput(allDay, EAST)).toBe("2026-08-14");
    expect(allDay).toBe("2026-08-13T21:00:00.000Z");
  });

  it("keeps the day when a time is added, and picks a waking hour", () => {
    const allDay = fromDateInput("2026-08-14", EAST)!;
    const timed = setAllDay(allDay, false, EAST)!;
    // 09:00 local, not 00:00 — a task due at midnight reads as the day before.
    expect(toDateTimeInput(timed, EAST)).toBe("2026-08-14T09:00");
  });

  it("cannot move the day in a zone behind UTC either", () => {
    const timed = fromDateTimeInput("2026-08-14T23:30", WEST)!;
    expect(toDateInput(setAllDay(timed, true, WEST), WEST)).toBe("2026-08-14");
  });

  it("has nothing to toggle without a date", () => {
    expect(setAllDay(null, true, EAST)).toBeNull();
  });
});
