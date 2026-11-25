import { describe, expect, it } from "vitest";
import { parseExtractionResponse } from "@/lib/extraction/schema";

const validPerson = {
  temporaryId: "item-1",
  category: "person",
  action: "create",
  confidence: 0.98,
  summary: "Sarah is an important person in your life",
  structuredData: {
    name: "Sarah",
    relationship: null,
    birthdayPhrase: "September 22",
    notes: null,
    generalPreferences: [{ preferenceType: "like", value: "white flowers" }],
  },
  relationships: [],
  missingFields: ["relationship"],
  sourceText: "Sarah's birthday is September 22",
};

const validFoodPreference = {
  temporaryId: "item-2",
  category: "food_preference",
  action: "create",
  confidence: 0.95,
  summary: "Sarah dislikes mushrooms",
  structuredData: {
    subjectRef: "item-1",
    subjectName: "Sarah",
    foodName: "mushrooms",
    preferenceType: "dislike",
    severity: null,
    notes: null,
  },
  relationships: ["item-1"],
  missingFields: [],
  sourceText: "she hates mushrooms",
};

describe("parseExtractionResponse", () => {
  it("parses a valid multi-item response", () => {
    const result = parseExtractionResponse({ items: [validPerson, validFoodPreference] });
    expect(result.items).toHaveLength(2);
    expect(result.droppedCount).toBe(0);
    expect(result.items[0]!.category).toBe("person");
    expect(result.items[1]!.category).toBe("food_preference");
  });

  it("accepts an empty items array (nothing worth remembering)", () => {
    const result = parseExtractionResponse({ items: [] });
    expect(result.items).toHaveLength(0);
    expect(result.droppedCount).toBe(0);
  });

  it("drops invalid items but keeps valid ones", () => {
    const invalid = {
      ...validPerson,
      temporaryId: "item-3",
      structuredData: { ...validPerson.structuredData, name: "" }, // empty name
    };
    const result = parseExtractionResponse({ items: [validPerson, invalid] });
    expect(result.items).toHaveLength(1);
    expect(result.droppedCount).toBe(1);
  });

  it("rejects items whose category doesn't match their data shape", () => {
    const mismatched = { ...validPerson, category: "recipe" };
    const result = parseExtractionResponse({ items: [mismatched] });
    expect(result.items).toHaveLength(0);
    expect(result.droppedCount).toBe(1);
  });

  it("rejects malformed dates", () => {
    const badDate = {
      ...validPerson,
      structuredData: { ...validPerson.structuredData, birthday: "September 22" },
    };
    const result = parseExtractionResponse({ items: [badDate] });
    expect(result.droppedCount).toBe(1);
  });

  it("rejects a resolved due date that isn't a real instant", () => {
    // The confirmation UI writes this field when the user answers a date
    // question, so it arrives from the client and cannot be trusted.
    const task = {
      temporaryId: "item-9",
      category: "task",
      action: "create",
      confidence: 0.9,
      summary: "Collect the parcel",
      structuredData: {
        title: "Collect the parcel",
        notes: null,
        datePhrase: "next Friday",
        resolvedDueAt: "next Friday-ish",
      },
      relationships: [],
      missingFields: [],
      sourceText: "Collect the parcel next Friday",
    };
    expect(parseExtractionResponse({ items: [task] }).droppedCount).toBe(1);
    expect(
      parseExtractionResponse({
        items: [{ ...task, structuredData: { ...task.structuredData, resolvedDueAt: null } }],
      }).items,
    ).toHaveLength(1);
  });

  it("rejects out-of-range confidence", () => {
    const badConfidence = { ...validPerson, confidence: 1.7 };
    const result = parseExtractionResponse({ items: [badConfidence] });
    expect(result.droppedCount).toBe(1);
  });

  it("throws on a malformed envelope", () => {
    expect(() => parseExtractionResponse({ results: [] })).toThrow();
    expect(() => parseExtractionResponse("not json object")).toThrow();
    expect(() => parseExtractionResponse(null)).toThrow();
  });
});
