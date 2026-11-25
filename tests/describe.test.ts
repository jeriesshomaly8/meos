import { describe, expect, it } from "vitest";
import { describeItems, describeItemsCapitalised, uncertaintyHint } from "@/lib/extraction/describe";
import type { ExtractedItem } from "@/lib/extraction/schema";

/**
 * §1.8 — the copy audit.
 *
 * "MeOS picked out 3 things" and "Saved 3 things" restate a number the user can
 * get by counting the cards. "worth a check" names no field. Both are the same
 * failure: saying something true that carries no information.
 */

const dated = { datePhrase: null, resolvedDueAt: null, resolvedAllDay: true, dateAmbiguity: null };

function item(category: string, structuredData: unknown, missingFields: string[] = []): ExtractedItem {
  return {
    temporaryId: "x",
    action: "create",
    confidence: 0.9,
    summary: "s",
    relationships: [],
    missingFields,
    sourceText: "t",
    category,
    structuredData,
  } as unknown as ExtractedItem;
}

const task = item("task", { title: "Buy milk", notes: null, ...dated });
const person = item("person", {
  name: "Dana",
  relationship: null,
  birthdayPhrase: null,
  birthday: null,
  birthdayYearKnown: false,
  notes: null,
  generalPreferences: [],
});
const alarm = item("alarm", { title: "Wake up", ...dated });
const list = item("list", { title: "Shopping", listKind: "shopping", items: [], ...dated });
const houseplant = item("custom", {
  typeKey: "houseplant",
  singular: "Houseplant",
  plural: "Houseplants",
  icon: "leaf",
  color: "success",
  title: "Monstera",
  attributes: [],
  resolvedAttributes: {},
  reusedTypeKey: null,
  ...dated,
});

describe("describeItems", () => {
  it("names one thing with the right article", () => {
    expect(describeItems([task])).toBe("a task");
    // "an alarm", not "a alarm" — chosen by the leading vowel.
    expect(describeItems([alarm])).toBe("an alarm");
  });

  it("groups repeats and pluralises them", () => {
    expect(describeItems([person, person])).toBe("two people");
    expect(describeItems([task, task, task])).toBe("three tasks");
  });

  it("joins several kinds into one readable sentence", () => {
    expect(describeItems([task, person, person, list])).toBe("a task, two people and a list");
  });

  it("uses a custom type's own name rather than “new type”", () => {
    expect(describeItems([houseplant])).toBe("a houseplant");
    expect(describeItems([houseplant, houseplant])).toBe("two houseplants");
  });

  it("keeps the order the categories first appear in, matching the cards below", () => {
    expect(describeItems([list, task, list])).toBe("two lists and a task");
  });

  it("switches to a numeral once the count stops reading as a word", () => {
    expect(describeItems(Array.from({ length: 12 }, () => task))).toBe("12 tasks");
  });

  it("has something to say about an empty set", () => {
    expect(describeItems([])).toBe("nothing");
  });

  it("capitalises for the places that open a sentence with it", () => {
    expect(describeItemsCapitalised([task])).toBe("A task");
    expect(describeItemsCapitalised([alarm, person])).toBe("An alarm and a person");
  });
});

describe("uncertaintyHint", () => {
  /*
   * The replacement for "worth a check", which told the user to open the card
   * to discover what to check — the work the label was meant to save them.
   */
  it("names the field that is missing", () => {
    expect(uncertaintyHint(item("person", person.structuredData, ["relationship"]))).toBe(
      "no relationship",
    );
  });

  it("makes a camelCase field name readable", () => {
    expect(uncertaintyHint(item("document", {}, ["expirationDate"]))).toBe("no expiration date");
    expect(uncertaintyHint(item("document", {}, ["issuing_country"]))).toBe("no issuing country");
  });

  it("names only the first, because a card is not a list of faults", () => {
    expect(uncertaintyHint(item("document", {}, ["documentNumber", "issueDate"]))).toBe(
      "no document number",
    );
  });

  it("questions the classification when nothing is actually missing", () => {
    expect(uncertaintyHint(task)).toBe("check it's a task");
    expect(uncertaintyHint(alarm)).toBe("check it's an alarm");
  });

  it("questions a custom type by its own name", () => {
    expect(uncertaintyHint(houseplant)).toBe("check it's a houseplant");
  });
});
