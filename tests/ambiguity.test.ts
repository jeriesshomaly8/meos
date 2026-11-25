import { describe, expect, it } from "vitest";
import { applyDateChoice, dateAmbiguityOf } from "@/lib/extraction/ambiguity";
import { normaliseProposals } from "@/lib/extraction/normalise";
import { parseExtractionResponse, type ExtractedItem } from "@/lib/extraction/schema";
import { buildRpcItems } from "@/lib/extraction/to-rpc";
import { isoDateInZone } from "@/lib/temporal/zone";

/**
 * The other half of the "next Friday" story.
 *
 * `tests/shopping-list.test.ts` proves the resolver asks instead of guessing;
 * this proves the answer becomes a date, and that "no date" is an answer the
 * save path honours rather than the same silence v1 produced.
 */

const TZ = "Asia/Jerusalem";
const NOW = new Date("2026-08-10T15:30:00Z"); // Mon 10 Aug, 18:30 local
const ctx = { now: NOW, timeZone: TZ };

const AMBIGUOUS_RESPONSE = {
  items: [
    {
      temporaryId: "item-1",
      category: "task",
      action: "create",
      confidence: 0.9,
      summary: "Collect the parcel",
      relationships: [],
      missingFields: [],
      sourceText: "Collect the parcel next Friday",
      structuredData: { title: "Collect the parcel", notes: null, datePhrase: "next Friday" },
    },
    {
      temporaryId: "item-2",
      category: "list",
      action: "create",
      confidence: 0.9,
      summary: "A list",
      relationships: [],
      missingFields: [],
      sourceText: "shopping next Friday: milk",
      structuredData: {
        title: "Shopping list",
        listKind: "shopping",
        datePhrase: "next Friday",
        items: [{ text: "Milk", quantity: null, unit: null }],
      },
    },
  ],
};

function normalised() {
  const { items } = parseExtractionResponse(AMBIGUOUS_RESPONSE);
  return normaliseProposals(items, ctx).items;
}

const find = (items: ExtractedItem[], category: string) =>
  items.find((item) => item.category === category)!;

const dueAtOf = (item: ExtractedItem) =>
  buildRpcItems([{ item, existingPersonId: null }])[0]!.data.due_at as string | null;

describe("date ambiguity: reading the question", () => {
  const items = normalised();

  it("exposes the question and both readings on the proposal itself", () => {
    const ambiguity = dateAmbiguityOf(find(items, "task"));
    expect(ambiguity?.question).toContain("next Friday");
    expect(ambiguity?.options.map((option) => isoDateInZone(new Date(option.iso), TZ))).toEqual([
      "2026-08-14",
      "2026-08-21",
    ]);
  });

  it("has nothing to ask about categories that carry no date phrase", () => {
    const { items: noteItems } = parseExtractionResponse({
      items: [
        {
          temporaryId: "n1",
          category: "note",
          action: "create",
          confidence: 0.9,
          summary: "A thought",
          relationships: [],
          missingFields: [],
          sourceText: "A thought",
          structuredData: { title: null, content: "A thought", noteType: "idea" },
        },
      ],
    });
    expect(dateAmbiguityOf(noteItems[0]!)).toBeNull();
  });
});

describe("date ambiguity: applying the answer", () => {
  it("dates the task to the reading the user picked", () => {
    const task = find(normalised(), "task");
    const ambiguity = dateAmbiguityOf(task)!;
    const second = ambiguity.options[1]!;

    const answered = applyDateChoice(
      task,
      { kind: "option", iso: second.iso, allDay: second.allDay },
      ctx,
    );

    expect(isoDateInZone(new Date(dueAtOf(answered)!), TZ)).toBe("2026-08-21");
    expect(buildRpcItems([{ item: answered, existingPersonId: null }])[0]!.data.all_day).toBe(true);
  });

  it("keeps the question on the item so the answer can be changed", () => {
    const task = find(normalised(), "task");
    const options = dateAmbiguityOf(task)!.options;
    const first = applyDateChoice(
      task,
      { kind: "option", iso: options[0]!.iso, allDay: true },
      ctx,
    );
    const second = applyDateChoice(
      first,
      { kind: "option", iso: options[1]!.iso, allDay: true },
      ctx,
    );

    expect(dateAmbiguityOf(second)?.options).toHaveLength(2);
    expect(isoDateInZone(new Date(dueAtOf(second)!), TZ)).toBe("2026-08-21");
  });

  it("saves with no date when that is what the user chose", () => {
    const task = find(normalised(), "task");
    expect(dueAtOf(applyDateChoice(task, { kind: "undated" }, ctx))).toBeNull();
  });

  it("re-derives a list title once the day is known", () => {
    const list = find(normalised(), "list");
    // While the phrase was unresolved the title could only name the kind.
    expect(list.category === "list" && list.structuredData.title).toBe("Shopping");

    const answered = applyDateChoice(
      list,
      { kind: "option", iso: dateAmbiguityOf(list)!.options[0]!.iso, allDay: true },
      ctx,
    );
    expect(answered.category === "list" && answered.structuredData.title).toBe(
      "Shopping for 14 Aug",
    );
  });

  it("leaves the title naming only the kind when the user declines a date", () => {
    const list = find(normalised(), "list");
    const answered = applyDateChoice(list, { kind: "undated" }, ctx);
    expect(answered.category === "list" && answered.structuredData.title).toBe("Shopping");
    expect(dueAtOf(answered)).toBeNull();
  });

  it("ignores categories that have no date to resolve", () => {
    const { items } = parseExtractionResponse({
      items: [
        {
          temporaryId: "p1",
          category: "person",
          action: "create",
          confidence: 0.9,
          summary: "Dana",
          relationships: [],
          missingFields: [],
          sourceText: "Dana",
          structuredData: {
            name: "Dana",
            relationship: null,
            birthdayPhrase: null,
            notes: null,
            generalPreferences: [],
          },
        },
      ],
    });
    const person = items[0]!;
    expect(applyDateChoice(person, { kind: "undated" }, ctx)).toBe(person);
  });
});
