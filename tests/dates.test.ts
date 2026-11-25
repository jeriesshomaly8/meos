import { describe, expect, it } from "vitest";
import {
  daysUntil,
  daysUntilLabel,
  expiryStatus,
  formatEventDate,
  nextOccurrence,
  upcomingAge,
} from "@/lib/dates";

const TODAY = new Date(2026, 7, 9); // August 9, 2026 (local)

describe("formatEventDate", () => {
  it("shows the full date when the year is known", () => {
    expect(formatEventDate("2028-05-14", true)).toBe("May 14, 2028");
  });

  it("hides the sentinel year when the year is unknown", () => {
    expect(formatEventDate("2000-09-22", false)).toBe("September 22");
  });

  it("falls back to the raw string for invalid input", () => {
    expect(formatEventDate("not-a-date", true)).toBe("not-a-date");
  });
});

describe("nextOccurrence", () => {
  it("returns the upcoming occurrence this year for yearly events", () => {
    const next = nextOccurrence("2000-09-22", "yearly", TODAY);
    expect(next?.getFullYear()).toBe(2026);
    expect(next?.getMonth()).toBe(8);
    expect(next?.getDate()).toBe(22);
  });

  it("rolls to next year when the date already passed", () => {
    const next = nextOccurrence("2000-03-05", "yearly", TODAY);
    expect(next?.getFullYear()).toBe(2027);
  });

  it("treats today as upcoming, not past", () => {
    const next = nextOccurrence("2000-08-09", "yearly", TODAY);
    expect(next?.getFullYear()).toBe(2026);
    expect(next?.getDate()).toBe(9);
  });

  it("returns future one-off dates unchanged", () => {
    const next = nextOccurrence("2028-05-14", "none", TODAY);
    expect(next?.getFullYear()).toBe(2028);
  });

  it("returns null for past one-off dates", () => {
    expect(nextOccurrence("2020-01-01", "none", TODAY)).toBeNull();
  });
});

describe("daysUntil / daysUntilLabel", () => {
  it("counts calendar days", () => {
    expect(daysUntil(new Date(2026, 7, 10), TODAY)).toBe(1);
    expect(daysUntil(new Date(2026, 7, 9), TODAY)).toBe(0);
  });

  it("labels naturally", () => {
    expect(daysUntilLabel(0)).toBe("today");
    expect(daysUntilLabel(1)).toBe("tomorrow");
    expect(daysUntilLabel(12)).toBe("in 12 days");
    expect(daysUntilLabel(-3)).toBe("3 days ago");
  });
});

describe("expiryStatus", () => {
  it("flags expired documents", () => {
    expect(expiryStatus("2026-08-08", TODAY)).toBe("expired");
  });

  it("flags documents expiring within 90 days", () => {
    expect(expiryStatus("2026-10-01", TODAY)).toBe("expiring_soon");
  });

  it("flags documents expiring within a year", () => {
    expect(expiryStatus("2027-05-01", TODAY)).toBe("expiring_later");
  });

  it("marks far-future documents valid", () => {
    expect(expiryStatus("2028-05-14", TODAY)).toBe("valid");
  });

  it("handles missing expiration", () => {
    expect(expiryStatus(null, TODAY)).toBe("unknown");
  });
});

describe("upcomingAge", () => {
  it("computes the age being turned when the birth year is known", () => {
    expect(upcomingAge("1990-09-22", true, TODAY)).toBe(36);
  });

  it("never leaks the sentinel year as an age", () => {
    expect(upcomingAge("2000-09-22", false, TODAY)).toBeNull();
  });
});
