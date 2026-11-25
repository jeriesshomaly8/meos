import { describe, expect, it } from "vitest";
import { parseExtractionResponse } from "@/lib/extraction/schema";
import { normaliseProposals } from "@/lib/extraction/normalise";
import { missingRequirementOf } from "@/lib/extraction/ambiguity";
import { buildRpcItems } from "@/lib/extraction/to-rpc";
import { isoDateInZone, partsInZone } from "@/lib/temporal/zone";

/**
 * Reminders on the phrase-based date path (§Phase 3).
 *
 * This is the category the §1.3 bug hurt most: the model was asked to turn
 * "next Tuesday" into an instant, nothing re-derived the answer, and the value
 * it invented is what the Today screen then disagreed with. The model now
 * reports the words and `src/lib/temporal` does the arithmetic, so every case
 * below runs against a fixed clock with no API call.
 */

const TZ = "Asia/Jerusalem";
const NOW = new Date("2026-08-10T15:30:00Z"); // Mon 10 Aug, 18:30 local
const ctx = { now: NOW, timeZone: TZ };

function reminderResponse(title: string, datePhrase: string | null) {
  return {
    items: [
      {
        temporaryId: "r1",
        category: "reminder",
        action: "create",
        confidence: 0.9,
        summary: title,
        relationships: [],
        missingFields: [],
        sourceText: title,
        structuredData: {
          title,
          datePhrase,
          relatedRef: null,
          relatedEntityType: null,
          notes: null,
        },
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

describe("“Remind me to call the bank tomorrow at 9”", () => {
  const { items, rpc } = run(reminderResponse("Call the bank", "tomorrow at 9"));

  it("stays a reminder", () => {
    expect(items[0]!.category).toBe("reminder");
    expect(rpc[0]!.category).toBe("reminder");
  });

  it("resolves against the user's zone, not the server's", () => {
    const remindAt = new Date(rpc[0]!.data.remind_at as string);
    expect(isoDateInZone(remindAt, TZ)).toBe("2026-08-11");
    expect(partsInZone(remindAt, TZ).hour).toBe(9);
  });

  it("is savable", () => {
    expect(missingRequirementOf(items[0]!)).toBeNull();
  });
});

describe("a reminder with no timing at all", () => {
  const { items, rpc } = run(reminderResponse("Call the bank", null));

  it("keeps the reminder rather than inventing a day for it", () => {
    expect(items[0]!.category).toBe("reminder");
    expect(rpc[0]!.data.remind_at).toBeNull();
  });

  /*
   * `reminders.remind_at` is `not null`, so this one is blocked in the sheet
   * rather than sent to the database to fail as a 500 with no field named.
   */
  it("cannot be saved until a day is set", () => {
    expect(missingRequirementOf(items[0]!)).toBe("Set when this reminder should arrive.");
  });
});

describe("an ambiguous phrase on a reminder", () => {
  const { items, ambiguities } = run(reminderResponse("Call the bank", "next Friday"));

  it("asks instead of guessing, exactly as a task does", () => {
    expect(ambiguities).toHaveLength(1);
    expect(ambiguities[0]!.temporaryId).toBe("r1");
    expect(ambiguities[0]!.options.length).toBeGreaterThan(1);
  });

  it("leaves the date unset while the question is open, so Save stays blocked", () => {
    const item = items[0]!;
    if (item.category !== "reminder") throw new Error("expected a reminder");
    expect(item.structuredData.resolvedDueAt).toBeNull();
    expect(missingRequirementOf(item)).toBe("Set when this reminder should arrive.");
  });
});

describe("dedupe", () => {
  it("keeps two nudges with the same wording at different times", () => {
    const { items } = run({
      items: [
        ...reminderResponse("Take the pills", "today at 9").items,
        {
          ...reminderResponse("Take the pills", "today at 21:00").items[0]!,
          temporaryId: "r2",
        },
      ],
    });
    expect(items).toHaveLength(2);
  });

  it("collapses the same nudge stated twice", () => {
    const { items } = run({
      items: [
        ...reminderResponse("Take the pills", "today at 9").items,
        {
          ...reminderResponse("Take the pills", "today at 9").items[0]!,
          temporaryId: "r2",
        },
      ],
    });
    expect(items).toHaveLength(1);
  });
});
