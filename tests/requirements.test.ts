import { describe, expect, it } from "vitest";
import { missingRequirementOf } from "@/lib/extraction/ambiguity";
import { parseExtractionResponse, type ExtractedItem } from "@/lib/extraction/schema";

/**
 * Required-field validation in the confirmation sheet (§Phase 4).
 *
 * The gap this closes: every required field was enforced only by Zod at the
 * save route, so clearing a title in the editor and pressing Save returned a
 * 400 that named no field. `missingRequirementOf()` now answers before the
 * request is made, and `ConfirmationPanel` disables Save while any kept item
 * has an answer.
 *
 * Note these states are deliberately *unparseable*: `z.string().min(1)` means a
 * blank title cannot come out of `parseExtractionResponse`. It can only be
 * reached by a user emptying the field afterwards, which is exactly the case
 * that used to fall through to Zod.
 */

const base = {
  temporaryId: "x1",
  action: "create" as const,
  confidence: 0.9,
  summary: "summary",
  relationships: [],
  missingFields: [],
  sourceText: "source",
};

const dated = { datePhrase: null, resolvedDueAt: null, resolvedAllDay: true, dateAmbiguity: null };

/** Valid fixtures, one per category, checked against the real schema below. */
const VALID: Record<string, unknown> = {
  person: {
    name: "Dana",
    relationship: null,
    birthdayPhrase: null,
    birthday: null,
    birthdayYearKnown: false,
    notes: null,
    generalPreferences: [],
  },
  important_date: {
    title: "Anniversary",
    datePhrase: "4 May",
    eventDate: "2026-05-04",
    yearKnown: true,
    recurrence: "yearly",
    personRef: null,
    notes: null,
  },
  reminder: {
    title: "Call the bank",
    relatedRef: null,
    relatedEntityType: null,
    notes: null,
    ...dated,
    resolvedDueAt: "2026-08-11T06:00:00.000Z",
    resolvedAllDay: false,
  },
  food_preference: {
    subjectRef: null,
    subjectName: null,
    foodName: "peanuts",
    preferenceType: "allergy",
    severity: "severe",
    notes: null,
  },
  recipe: {
    name: "Shakshuka",
    description: null,
    preparationTimeMinutes: null,
    cookingTimeMinutes: null,
    servings: null,
    instructions: null,
    ingredients: [],
    notes: null,
  },
  document: {
    documentType: "passport",
    displayName: "Passport",
    documentNumber: null,
    issuePhrase: null,
    expiryPhrase: null,
    issueDate: null,
    expirationDate: null,
    issuingCountry: null,
    notes: null,
  },
  note: { title: null, content: "A thought worth keeping", noteType: "idea" },
  task: { title: "Buy milk", notes: null, ...dated },
  list: {
    title: "Shopping",
    listKind: "shopping",
    items: [{ text: "Milk", quantity: null, unit: null }],
    ...dated,
  },
  alarm: {
    title: "Wake up",
    ...dated,
    resolvedDueAt: "2026-08-11T04:00:00.000Z",
    resolvedAllDay: false,
  },
};

/**
 * The one cast in this file. A cleared required field is unrepresentable in the
 * parsed type — which is the point — so the invalid cases are built by hand.
 */
function itemOf(category: string, structuredData: unknown): ExtractedItem {
  return { ...base, category, structuredData } as unknown as ExtractedItem;
}

describe("every category's valid fixture is genuinely valid", () => {
  it("parses, so the negative cases below are the only thing being changed", () => {
    const raw = {
      items: Object.entries(VALID).map(([category, structuredData], i) => ({
        ...base,
        temporaryId: `x${i}`,
        category,
        structuredData,
      })),
    };
    const { items, droppedCount } = parseExtractionResponse(raw);
    expect(droppedCount).toBe(0);
    expect(items).toHaveLength(Object.keys(VALID).length);
  });

  it.each(Object.keys(VALID))("%s is savable as supplied", (category) => {
    expect(missingRequirementOf(itemOf(category, VALID[category]))).toBeNull();
  });
});

describe("a required field the user cleared blocks the save and names itself", () => {
  const CLEARED: [string, Record<string, unknown>][] = [
    ["person", { name: "" }],
    ["important_date", { title: "  " }],
    ["reminder", { title: "" }],
    ["food_preference", { foodName: "" }],
    ["recipe", { name: "" }],
    ["document", { displayName: "" }],
    ["note", { content: "   " }],
    ["task", { title: "" }],
    ["list", { title: "" }],
    ["alarm", { title: "" }],
  ];

  it.each(CLEARED)("%s", (category, override) => {
    const item = itemOf(category, { ...(VALID[category] as object), ...override });
    const message = missingRequirementOf(item);
    expect(message).not.toBeNull();
    // Whitespace counts as cleared — a title of spaces helps nobody.
    expect(message).not.toMatch(/undefined|null/);
  });
});

describe("the categories whose date is not optional", () => {
  it("an important date with no resolvable date asks for one", () => {
    // "sometime in spring" resolves to nothing; event_date is NOT NULL, so
    // saving would be a 500 from the writer instead of a named message.
    const item = itemOf("important_date", {
      ...(VALID.important_date as object),
      datePhrase: "sometime in spring",
      eventDate: null,
    });
    expect(missingRequirementOf(item)).toBe("Pick the date this falls on.");
  });

  it("an alarm with a day but no clock time asks for the time", () => {
    const item = itemOf("alarm", {
      ...(VALID.alarm as object),
      resolvedDueAt: "2026-08-11T00:00:00.000Z",
      resolvedAllDay: true,
    });
    expect(missingRequirementOf(item)).toBe("Set the time this should ring.");
  });

  it("a reminder with no date at all asks for one", () => {
    const item = itemOf("reminder", { ...(VALID.reminder as object), resolvedDueAt: null });
    expect(missingRequirementOf(item)).toBe("Set when this reminder should arrive.");
  });

  it("a reminder with a whole day but no time is fine — it is a nudge, not a ring", () => {
    const item = itemOf("reminder", {
      ...(VALID.reminder as object),
      resolvedDueAt: "2026-08-11T00:00:00.000Z",
      resolvedAllDay: true,
    });
    expect(missingRequirementOf(item)).toBeNull();
  });
});

describe("a task stays savable without a date", () => {
  it("because an undated task is a perfectly ordinary thing to keep", () => {
    expect(missingRequirementOf(itemOf("task", VALID.task))).toBeNull();
  });
});

describe("a list with nothing in it", () => {
  it("is blocked, because it would save as a heading with no contents", () => {
    const empty = itemOf("list", { ...(VALID.list as object), items: [] });
    expect(missingRequirementOf(empty)).toBe("Add at least one thing to the list.");
  });

  it("is blocked when every row was emptied rather than removed", () => {
    const blanked = itemOf("list", {
      ...(VALID.list as object),
      items: [{ text: "  ", quantity: null, unit: null }],
    });
    expect(missingRequirementOf(blanked)).toBe("Add at least one thing to the list.");
  });
});
