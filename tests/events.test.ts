import { describe, expect, it } from "vitest";
import { parseExtractionResponse } from "@/lib/extraction/schema";
import { normaliseProposals } from "@/lib/extraction/normalise";
import { eventDateRequirement, missingRequirementOf } from "@/lib/extraction/ambiguity";
import { buildRpcItems } from "@/lib/extraction/to-rpc";
import { convertCategory } from "@/lib/extraction/convert";
import { anchorInstant, groupByDue, type ItemRow } from "@/lib/items/rows";
import { calendarProviders } from "@/lib/calendar/provider";
import { isoDateInZone, partsInZone } from "@/lib/temporal/zone";

/**
 * Phase 5: "dinner with Dana at 8" gets somewhere to live. Everything here is
 * the deterministic pipeline — extraction shape, phrase resolution, the RPC
 * payload that writes `starts_at`, and the read-side grouping that keeps a
 * past event out of "overdue". The writer branch itself is pinned by running
 * migration 0012 against the database.
 */

const TZ = "Asia/Jerusalem";
const NOW = new Date("2026-08-10T15:30:00Z"); // Mon 10 Aug, 18:30 local
const ctx = { now: NOW, timeZone: TZ };

function eventResponse(title: string, datePhrase: string | null, location: string | null = null) {
  return {
    items: [
      {
        temporaryId: "e1",
        category: "event",
        action: "create",
        confidence: 0.95,
        summary: title,
        relationships: [],
        missingFields: [],
        sourceText: title,
        structuredData: { title, location, notes: null, datePhrase },
      },
    ],
  };
}

function run(raw: unknown) {
  const { items } = parseExtractionResponse(raw);
  const normalised = normaliseProposals(items, ctx);
  const rpc = buildRpcItems(normalised.items.map((item) => ({ item, existingPersonId: null })));
  return { ...normalised, rpc };
}

describe("“Dinner with Dana tomorrow at 8”", () => {
  const { items, rpc } = run(eventResponse("Dinner with Dana", "tomorrow at 8pm", "the harbour"));

  it("is an event, and its instant is a start, not a due date", () => {
    expect(items[0]!.category).toBe("event");
    expect(rpc[0]!.category).toBe("event");
    expect(rpc[0]!.data.starts_at).toBeTruthy();
    expect(rpc[0]!.data).not.toHaveProperty("due_at");
  });

  it("starts at 20:00 on the user's tomorrow, not the server's", () => {
    const startsAt = new Date(rpc[0]!.data.starts_at as string);
    expect(isoDateInZone(startsAt, TZ)).toBe("2026-08-11");
    expect(partsInZone(startsAt, TZ).hour).toBe(20);
  });

  it("carries the location", () => {
    expect(rpc[0]!.data.location).toBe("the harbour");
  });

  it("is savable", () => {
    expect(missingRequirementOf(items[0]!)).toBeNull();
  });
});

describe("an all-day event", () => {
  const { items, rpc } = run(eventResponse("Conference", "tomorrow"));

  it("is legal — a day without a clock time is a real event, unlike an alarm", () => {
    expect(rpc[0]!.data.all_day).toBe(true);
    expect(missingRequirementOf(items[0]!)).toBeNull();
  });
});

describe("an event with no when", () => {
  const { items } = run(eventResponse("Dinner with Dana", null));

  it("is blocked by name — an event with no when is a note wearing a calendar icon", () => {
    expect(missingRequirementOf(items[0]!)).toBe("Set when this happens.");
    const item = items[0]!;
    if (item.category !== "event") throw new Error("wrong category");
    expect(eventDateRequirement(item.structuredData)).toBe("Set when this happens.");
  });
});

describe("the same dinner mentioned twice", () => {
  const raw = eventResponse("Dinner with Dana", "tomorrow at 8pm");
  raw.items.push({ ...raw.items[0]!, temporaryId: "e2" });
  const { items } = run(raw);

  it("collapses to one, keyed on title and moment", () => {
    expect(items).toHaveLength(1);
  });
});

describe("a note corrected into an event", () => {
  const { items } = run({
    items: [
      {
        temporaryId: "n1",
        category: "note",
        action: "create",
        confidence: 0.8,
        summary: "Dinner plan",
        relationships: [],
        missingFields: [],
        sourceText: "dinner with Dana at the harbour",
        structuredData: { title: null, content: "Dinner with Dana", noteType: "general" },
      },
    ],
  });
  const converted = convertCategory(items[0]!, "event", ctx);

  it("becomes an event that asks for its when instead of inventing one", () => {
    expect(converted.category).toBe("event");
    expect(missingRequirementOf(converted)).toBe("Set when this happens.");
  });
});

describe("read-side grouping", () => {
  const eventRow = (id: string, startsAt: string): ItemRow => ({
    id,
    capability: "event",
    title: "Dinner",
    summary: null,
    status: "active",
    due_at: null,
    all_day: false,
    starts_at: startsAt,
    ends_at: null,
    completed_at: null,
    created_at: "2026-08-01T00:00:00Z",
    list_items: [],
  });

  it("anchors an event on starts_at, so it never lands in undated", () => {
    const row = eventRow("e1", "2026-08-10T17:00:00Z");
    expect(anchorInstant(row)).toBe("2026-08-10T17:00:00Z");
    const groups = groupByDue([row], NOW, TZ);
    expect(groups.today.map((item) => item.id)).toEqual(["e1"]);
    expect(groups.undated).toHaveLength(0);
  });

  it("treats a past event as over, never overdue", () => {
    const groups = groupByDue([eventRow("e0", "2026-08-08T17:00:00Z")], NOW, TZ);
    expect(groups.overdue).toHaveLength(0);
    expect(groups.past.map((item) => item.id)).toEqual(["e0"]);
    expect(groups.past[0]!.overdue).toBe(false);
  });
});

describe("calendar providers", () => {
  it("offers the feed, configured exactly when a token exists", () => {
    const [feed] = calendarProviders({ feedToken: "tok" });
    expect(feed!.available).toBe(true);
    expect(feed!.configured).toBe(true);
    expect(calendarProviders({ feedToken: null })[0]!.configured).toBe(false);
  });

  it("declares Google honestly unavailable, with a reason and no configured state", () => {
    const google = calendarProviders({ feedToken: null }).find((p) => p.key === "google")!;
    expect(google.available).toBe(false);
    expect(google.configured).toBe(false);
    expect(google.unavailableReason).toBeTruthy();
  });
});
