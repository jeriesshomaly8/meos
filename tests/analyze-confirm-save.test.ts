import { describe, expect, it } from "vitest";
import { parseExtractionResponse } from "@/lib/extraction/schema";
import { normaliseProposals } from "@/lib/extraction/normalise";
import { buildRpcItems, type ApprovedItem } from "@/lib/extraction/to-rpc";

/**
 * Integration test of the analyze → confirm → save pipeline logic:
 * a raw AI response (as the provider would return it) is validated,
 * normalised against a fixed clock, treated as user-approved, and converted
 * into the transactional RPC payload. The AI call and the database are the
 * only pieces not exercised here.
 */

const TZ = "Asia/Jerusalem";
const NOW = new Date("2026-08-10T15:30:00Z"); // Mon 10 Aug, 18:30 local

// The canonical example from the product spec:
// "My passport expires on May 14, 2028. Remind me six months before.
//  Sarah's birthday is September 22 and she loves white flowers."
const AI_RESPONSE = {
  items: [
    {
      temporaryId: "item-1",
      category: "document",
      action: "create",
      confidence: 0.97,
      summary: "Your passport expires May 14, 2028",
      structuredData: {
        documentType: "passport",
        displayName: "Passport",
        documentNumber: null,
        // The model reports the phrases; `normaliseProposals()` resolves them.
        issuePhrase: null,
        expiryPhrase: "May 14, 2028",
        issuingCountry: null,
        notes: null,
      },
      relationships: [],
      missingFields: ["documentNumber", "issuePhrase", "issuingCountry"],
      sourceText: "My passport expires on May 14, 2028",
    },
    {
      temporaryId: "item-2",
      category: "reminder",
      action: "create",
      confidence: 0.95,
      summary: "Renew passport — reminder six months before expiration",
      structuredData: {
        title: "Renew passport",
        // The model reports the phrase; `normaliseProposals()` resolves it.
        datePhrase: "six months before",
        relatedRef: "item-1",
        relatedEntityType: "document",
        notes: null,
      },
      relationships: ["item-1"],
      missingFields: [],
      sourceText: "Remind me six months before",
    },
    {
      temporaryId: "item-3",
      category: "person",
      action: "create",
      confidence: 0.98,
      summary: "Sarah, birthday September 22, loves white flowers",
      structuredData: {
        name: "Sarah",
        relationship: null,
        birthdayPhrase: "September 22",
        notes: null,
        generalPreferences: [{ preferenceType: "like", value: "white flowers" }],
      },
      relationships: ["item-4"],
      missingFields: ["relationship"],
      sourceText: "Sarah's birthday is September 22 and she loves white flowers",
    },
    {
      temporaryId: "item-4",
      category: "important_date",
      action: "create",
      confidence: 0.97,
      summary: "Sarah's birthday — September 22, yearly",
      structuredData: {
        title: "Sarah's birthday",
        datePhrase: "September 22",
        recurrence: "yearly",
        personRef: "item-3",
        notes: null,
      },
      relationships: ["item-3"],
      missingFields: [],
      sourceText: "Sarah's birthday is September 22",
    },
  ],
};

function approveAll(): ApprovedItem[] {
  const { items } = parseExtractionResponse(AI_RESPONSE);
  const normalised = normaliseProposals(items, { now: NOW, timeZone: TZ });
  return normalised.items.map((item) => ({ item, existingPersonId: null }));
}

describe("analyze → confirm → save pipeline", () => {
  it("validates the full spec example without dropping items", () => {
    const { items, droppedCount } = parseExtractionResponse(AI_RESPONSE);
    expect(items).toHaveLength(4);
    expect(droppedCount).toBe(0);
  });

  it("builds one RPC item per approved item plus general preferences", () => {
    const rpcItems = buildRpcItems(approveAll());
    const categories = rpcItems.map((item) => item.category).sort();
    // 4 approved + 1 person_preference expanded from Sarah's generalPreferences.
    expect(rpcItems).toHaveLength(5);
    expect(categories).toEqual([
      "document",
      "important_date",
      "person",
      "person_preference",
      "reminder",
    ]);
  });

  it("keeps person references pointing at in-batch temporaryIds", () => {
    const rpcItems = buildRpcItems(approveAll());
    const birthday = rpcItems.find((item) => item.category === "important_date")!;
    expect(birthday.personRef).toBe("item-3");
    const generalPref = rpcItems.find((item) => item.category === "person_preference")!;
    expect(generalPref.personRef).toBe("item-3");
    expect(generalPref.data.value).toBe("white flowers");
  });

  it("wires the reminder to its document", () => {
    const rpcItems = buildRpcItems(approveAll());
    const reminder = rpcItems.find((item) => item.category === "reminder")!;
    expect(reminder.data.related_ref).toBe("item-1");
    expect(reminder.data.related_entity_type).toBe("document");
  });

  it("preserves unknown-year flags end to end", () => {
    const rpcItems = buildRpcItems(approveAll());
    const person = rpcItems.find((item) => item.category === "person")!;
    expect(person.data.birthday).toBe("2000-09-22");
    expect(person.data.birthday_year_known).toBe(false);
    const birthday = rpcItems.find((item) => item.category === "important_date")!;
    expect(birthday.data.year_known).toBe(false);
  });

  it("marks a person as update when the user confirmed an existing match", () => {
    const approved = approveAll().map((entry) =>
      entry.item.category === "person"
        ? { ...entry, existingPersonId: "3e0f4c1a-9a3b-4f6e-8f2d-0123456789ab" }
        : entry,
    );
    const rpcItems = buildRpcItems(approved);
    const person = rpcItems.find((item) => item.category === "person")!;
    expect(person.action).toBe("update");
    expect(person.existingId).toBe("3e0f4c1a-9a3b-4f6e-8f2d-0123456789ab");
  });

  it("drops references to items the user excluded", () => {
    const approved = approveAll().filter((entry) => entry.item.temporaryId !== "item-1");
    const rpcItems = buildRpcItems(approved);
    const reminder = rpcItems.find((item) => item.category === "reminder")!;
    // related_ref survives (RPC resolves it to null when the target is absent)
    // but no entity link is created for the excluded item.
    expect(reminder.links).toHaveLength(0);
  });

  it("synthesizes a minimal person for food preferences about someone new", () => {
    const { items } = parseExtractionResponse({
      items: [
        {
          temporaryId: "item-1",
          category: "food_preference",
          action: "create",
          confidence: 0.9,
          summary: "Mom is allergic to peanuts",
          structuredData: {
            subjectRef: null,
            subjectName: "Mom",
            foodName: "peanuts",
            preferenceType: "allergy",
            severity: "severe",
            notes: null,
          },
          relationships: [],
          missingFields: [],
          sourceText: "Mom is allergic to peanuts",
        },
      ],
    });
    const rpcItems = buildRpcItems(items.map((item) => ({ item, existingPersonId: null })));
    expect(rpcItems).toHaveLength(2);
    const person = rpcItems.find((item) => item.category === "person")!;
    expect(person.data.name).toBe("Mom");
    const pref = rpcItems.find((item) => item.category === "food_preference")!;
    expect(pref.personRef).toBe(person.temporaryId);
    expect(pref.data.severity).toBe("severe");
  });

  it("does not duplicate synthesized people for repeated subjects", () => {
    const foodItem = (name: string, id: string) => ({
      temporaryId: id,
      category: "food_preference",
      action: "create",
      confidence: 0.9,
      summary: `${name} food note`,
      structuredData: {
        subjectRef: null,
        subjectName: name,
        foodName: "cilantro",
        preferenceType: "dislike",
        severity: null,
        notes: null,
      },
      relationships: [],
      missingFields: [],
      sourceText: `${name} hates cilantro`,
    });
    const { items } = parseExtractionResponse({
      items: [foodItem("Dad", "item-1"), foodItem("dad", "item-2")],
    });
    const rpcItems = buildRpcItems(items.map((item) => ({ item, existingPersonId: null })));
    expect(rpcItems.filter((item) => item.category === "person")).toHaveLength(1);
  });
});
