import { describe, expect, it } from "vitest";
import { parseExtractionResponse, type ExtractedItem } from "@/lib/extraction/schema";
import { normaliseProposals } from "@/lib/extraction/normalise";
import { buildRpcItems, type RpcItem } from "@/lib/extraction/to-rpc";
import { isoDateInZone } from "@/lib/temporal/zone";

/**
 * The mandated acceptance test, end to end through every deterministic stage:
 * model output -> Zod -> normalisation -> RPC payload.
 *
 * The model's reply is a fixture, never a live call, so this is fast and
 * stable. What it proves is that everything *after* the model is correct —
 * which is exactly where v1's date handling went wrong.
 */

const TZ = "Asia/Jerusalem";
const NOW = new Date("2026-08-10T15:30:00Z"); // Mon 10 Aug, 18:30 local
const ctx = { now: NOW, timeZone: TZ };

/** What the prompt asks the model to return for the mandated sentence. */
const SHOPPING_RESPONSE = {
  items: [
    {
      temporaryId: "item-1",
      category: "list",
      action: "create",
      confidence: 0.94,
      summary: "A list", // deliberately generic — normalisation must replace it
      relationships: ["item-2"],
      missingFields: [],
      sourceText: "Make a shopping list for today: milk, bread and eggs.",
      structuredData: {
        title: "Shopping list", // deliberately vague — must be derived instead
        listKind: "shopping",
        datePhrase: "today",
        items: [
          { text: "Milk", quantity: null, unit: null },
          { text: "Bread", quantity: null, unit: null },
          { text: "Eggs", quantity: null, unit: null },
        ],
      },
    },
    {
      temporaryId: "item-2",
      category: "task",
      action: "create",
      confidence: 0.8,
      summary: "Do the shopping",
      relationships: ["item-1"],
      missingFields: [],
      sourceText: "Make a shopping list for today",
      structuredData: { title: "Do the shopping", notes: null, datePhrase: "today" },
    },
  ],
};

function run(raw: unknown) {
  const { items, droppedCount } = parseExtractionResponse(raw);
  const normalised = normaliseProposals(items, ctx);
  const rpc = buildRpcItems(normalised.items.map((item) => ({ item, existingPersonId: null })));
  return { ...normalised, droppedCount, rpc };
}

const byCategory = (rpc: RpcItem[], category: string) => rpc.find((r) => r.category === category)!;

describe("acceptance: “Make a shopping list for today: milk, bread and eggs”", () => {
  const result = run(SHOPPING_RESPONSE);

  it("produces a list, not a note", () => {
    expect(result.items.map((i) => i.category).sort()).toEqual(["list", "task"]);
    expect(result.items.some((i) => i.category === "note")).toBe(false);
  });

  it("stores each item as a separate checkable row", () => {
    const list = byCategory(result.rpc, "list");
    expect(list.data.list_items).toEqual([
      { text: "Milk", quantity: null, unit: null },
      { text: "Bread", quantity: null, unit: null },
      { text: "Eggs", quantity: null, unit: null },
    ]);
  });

  it("dates the list to today in the user's timezone, not the server's", () => {
    const list = byCategory(result.rpc, "list");
    const dueAt = new Date(list.data.due_at as string);
    expect(isoDateInZone(dueAt, TZ)).toBe("2026-08-10");
    // The stored instant is local midnight, which is the previous day in UTC —
    // exactly the boundary v1 got wrong.
    expect(dueAt.toISOString()).toBe("2026-08-09T21:00:00.000Z");
    expect(list.data.all_day).toBe(true);
  });

  it("derives a specific title instead of using the model's vague one", () => {
    expect(byCategory(result.rpc, "list").data.title).toBe("Shopping for today");
  });

  it("summarises by contents, not by restating the category", () => {
    const summary = result.items.find((i) => i.category === "list")!.summary;
    expect(summary).toBe("Milk, Bread, Eggs");
    expect(summary.toLowerCase()).not.toContain("list");
  });

  it("keeps the phrase the date came from, so the UI can show its working", () => {
    expect(byCategory(result.rpc, "list").data.date_phrase).toBe("today");
  });

  it("links the task to the list", () => {
    const task = byCategory(result.rpc, "task");
    expect(task.links).toContainEqual({
      targetRef: "item-1",
      targetType: "list",
      relationshipType: "related_to",
    });
  });

  it("asks nothing, because 'today' is unambiguous", () => {
    expect(result.ambiguities).toEqual([]);
  });
});

describe("task vs note, and undated tasks", () => {
  function taskResponse(title: string, datePhrase: string | null) {
    return {
      items: [
        {
          temporaryId: "t1",
          category: "task",
          action: "create",
          confidence: 0.7,
          summary: title,
          relationships: [],
          missingFields: datePhrase ? [] : ["datePhrase"],
          sourceText: title,
          structuredData: { title, notes: null, datePhrase },
        },
      ],
    };
  }

  it("“Buy milk” stays an undated task rather than inventing a day", () => {
    const { rpc } = run(taskResponse("Buy milk", null));
    expect(rpc[0]!.category).toBe("task");
    expect(rpc[0]!.data.due_at).toBeNull();
  });

  it("“Buy milk tomorrow” is due tomorrow", () => {
    const { rpc } = run(taskResponse("Buy milk", "tomorrow"));
    expect(isoDateInZone(new Date(rpc[0]!.data.due_at as string), TZ)).toBe("2026-08-11");
  });

  it("surfaces a real question for “next Friday” instead of guessing", () => {
    const { ambiguities, rpc } = run(taskResponse("Collect the parcel", "next Friday"));
    expect(ambiguities).toHaveLength(1);
    expect(ambiguities[0]!.question).toContain("14 Aug");
    expect(ambiguities[0]!.question).toContain("21 Aug");
    expect(ambiguities[0]!.options.map((o) => isoDateInZone(new Date(o.iso), TZ))).toEqual([
      "2026-08-14",
      "2026-08-21",
    ]);
    // Nothing is dated until the user picks.
    expect(rpc[0]!.data.due_at).toBeNull();
  });
});

describe("deduplication", () => {
  it("collapses the same person proposed twice, keeping the confident one", () => {
    const person = (confidence: number, relationship: string | null): ExtractedItem =>
      ({
        temporaryId: `p${confidence}`,
        category: "person",
        action: "create",
        confidence,
        summary: "Dana",
        relationships: [],
        missingFields: [],
        sourceText: "Dana",
        structuredData: {
          name: "Dana",
          relationship,
          birthdayPhrase: null,
          birthday: null,
          birthdayYearKnown: true,
          notes: null,
          generalPreferences: [],
        },
      }) as ExtractedItem;

    const { items } = normaliseProposals([person(0.5, null), person(0.9, "sister")], ctx);
    expect(items).toHaveLength(1);
    expect(items[0]!.category === "person" && items[0]!.structuredData.relationship).toBe("sister");
  });

  it("keeps genuinely different items apart", () => {
    const { items } = normaliseProposals(
      parseExtractionResponse(SHOPPING_RESPONSE).items,
      ctx,
    );
    expect(items).toHaveLength(2);
  });
});
