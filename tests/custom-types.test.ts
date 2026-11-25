import { describe, expect, it } from "vitest";
import { parseExtractionResponse } from "@/lib/extraction/schema";
import { foldAttributes, normaliseProposals } from "@/lib/extraction/normalise";
import { missingRequirementOf } from "@/lib/extraction/ambiguity";
import { buildRpcItems } from "@/lib/extraction/to-rpc";
import { findReusableType, normaliseTypeKey, type ItemType } from "@/lib/items/types";
import { MAX_ATTRIBUTE_KEYS } from "@/lib/items/attributes";

/**
 * Custom types — Phase 3's last open item.
 *
 * The registry, the attribute guard and the reuse matcher have existed since
 * migration 0005 and nothing ever proposed a type, so the flexible half of v2
 * was built and unused. Everything here is the deterministic side of closing
 * that: what the model may propose, what survives validation, and what the
 * writer is handed. Whether the model proposes sensibly is a prompt question
 * and is not testable without an API call.
 */

const TZ = "Asia/Jerusalem";
const NOW = new Date("2026-08-10T15:30:00Z");

function coreType(key: string, singular: string, plural: string): ItemType {
  return {
    key,
    singular,
    plural,
    icon: "box",
    color: "neutral",
    kind: "core",
    defaultCapability: "record",
    fieldSchema: [],
    hidden: false,
    mergedInto: null,
  };
}

function customResponse(
  overrides: Partial<{
    typeKey: string;
    singular: string;
    plural: string;
    title: string;
    datePhrase: string | null;
    attributes: { key: string; value: string }[];
  }> = {},
) {
  return {
    items: [
      {
        temporaryId: "c1",
        category: "custom",
        action: "create",
        confidence: 0.8,
        summary: "Monstera by the window",
        relationships: [],
        missingFields: [],
        sourceText: "my monstera lives by the window and needs water weekly",
        structuredData: {
          typeKey: "houseplant",
          singular: "Houseplant",
          plural: "Houseplants",
          icon: "leaf",
          color: "success",
          title: "Monstera",
          datePhrase: null,
          attributes: [
            { key: "location", value: "living room" },
            { key: "watering", value: "weekly" },
          ],
          ...overrides,
        },
      },
    ],
  };
}

function run(raw: unknown, existingTypes: ItemType[] = []) {
  const { items, droppedCount } = parseExtractionResponse(raw);
  const normalised = normaliseProposals(items, { now: NOW, timeZone: TZ, existingTypes });
  const rpc = buildRpcItems(normalised.items.map((item) => ({ item, existingPersonId: null })));
  return { ...normalised, rpc, droppedCount };
}

describe("a thing that fits no existing category", () => {
  const { items, rpc, droppedCount } = run(customResponse());

  it("parses as a custom proposal rather than being dropped", () => {
    expect(droppedCount).toBe(0);
    expect(items[0]!.category).toBe("custom");
  });

  it("folds the model's key/value pairs into the object the database stores", () => {
    const item = items[0]!;
    if (item.category !== "custom") throw new Error("expected a custom item");
    expect(item.structuredData.resolvedAttributes).toEqual({
      location: "living room",
      watering: "weekly",
    });
  });

  it("hands the writer a type to create and a record to file under it", () => {
    expect(rpc[0]!.category).toBe("custom");
    expect(rpc[0]!.data.type_key).toBe("houseplant");
    expect(rpc[0]!.data.title).toBe("Monstera");
    expect(rpc[0]!.data.attributes).toEqual({ location: "living room", watering: "weekly" });
  });

  it("is savable", () => {
    expect(missingRequirementOf(items[0]!)).toBeNull();
  });
});

describe("the key is normalised before anything is created", () => {
  it("collapses spelling and pluralisation to one key", () => {
    expect(normaliseTypeKey("Gift Ideas")).toBe("gift_idea");
    expect(normaliseTypeKey("gift-idea")).toBe("gift_idea");
    expect(normaliseTypeKey("Vinyl Records")).toBe("vinyl_record");
    expect(normaliseTypeKey("Medications")).toBe("medication");
  });

  it("applies that to what the model proposed", () => {
    const { rpc } = run(customResponse({ typeKey: "House Plants" }));
    expect(rpc[0]!.data.type_key).toBe("house_plant");
  });
});

describe("matching against types the user already has", () => {
  const existing = [coreType("houseplant", "Houseplant", "Houseplants")];

  it("reuses the existing type instead of creating a near-duplicate", () => {
    const { items, rpc } = run(customResponse({ typeKey: "houseplants" }), existing);
    const item = items[0]!;
    if (item.category !== "custom") throw new Error("expected a custom item");

    expect(item.structuredData.reusedTypeKey).toBe("houseplant");
    expect(rpc[0]!.data.type_key).toBe("houseplant");
  });

  it("matches on the type's name too, not only its key", () => {
    const { items } = run(
      customResponse({ typeKey: "indoor_plant", singular: "Houseplant", plural: "Houseplants" }),
      existing,
    );
    const item = items[0]!;
    if (item.category !== "custom") throw new Error("expected a custom item");
    expect(item.structuredData.reusedTypeKey).toBe("houseplant");
  });

  it("says the type is new when it genuinely is", () => {
    // Key *and* names have to differ — matching on either is the point.
    const { items } = run(
      customResponse({ typeKey: "vinyl_record", singular: "Vinyl record", plural: "Vinyl records" }),
      existing,
    );
    const item = items[0]!;
    if (item.category !== "custom") throw new Error("expected a custom item");
    expect(item.structuredData.reusedTypeKey).toBeNull();
  });

  it("never reuses a type that was merged away", () => {
    const merged: ItemType[] = [
      { ...coreType("houseplant", "Houseplant", "Houseplants"), mergedInto: "plant" },
    ];
    expect(
      findReusableType(
        {
          key: "houseplant",
          singular: "Houseplant",
          plural: "Houseplants",
          icon: "leaf",
          color: "success",
          defaultCapability: "record",
          fieldSchema: [],
        },
        merged,
      ),
    ).toBeNull();
  });
});

describe("foldAttributes", () => {
  it("drops a key the database would reject rather than failing the item", () => {
    expect(
      foldAttributes([
        { key: "Location", value: "living room" },
        { key: "9lives", value: "no" },
        { key: "watering days", value: "7" },
      ]),
    ).toEqual({ location: "living room", watering_days: "7" });
  });

  it("ignores empty values, which are the model padding the shape", () => {
    expect(foldAttributes([{ key: "location", value: "   " }])).toEqual({});
  });

  it("keeps the first mention when a key repeats", () => {
    expect(
      foldAttributes([
        { key: "location", value: "living room" },
        { key: "location", value: "kitchen" },
      ]),
    ).toEqual({ location: "living room" });
  });

  it("stops at the same key limit the Postgres check enforces", () => {
    const pairs = Array.from({ length: MAX_ATTRIBUTE_KEYS + 10 }, (_, i) => ({
      key: `key_${i}`,
      value: "x",
    }));
    expect(Object.keys(foldAttributes(pairs))).toHaveLength(MAX_ATTRIBUTE_KEYS);
  });
});

describe("the safety rails hold", () => {
  it("refuses an icon outside the approved set, so a type cannot look foreign", () => {
    const { droppedCount } = run({
      items: [
        {
          ...customResponse().items[0]!,
          structuredData: { ...customResponse().items[0]!.structuredData, icon: "skull" },
        },
      ],
    });
    expect(droppedCount).toBe(1);
  });

  it("blocks a proposal whose type has no name", () => {
    const { items } = run(customResponse());
    const item = items[0]!;
    if (item.category !== "custom") throw new Error("expected a custom item");
    const nameless = { ...item, structuredData: { ...item.structuredData, plural: "  " } };
    expect(missingRequirementOf(nameless)).toBe("Name the new type.");
  });

  it("blocks a proposal with no title, naming the type in the message", () => {
    const { items } = run(customResponse());
    const item = items[0]!;
    if (item.category !== "custom") throw new Error("expected a custom item");
    const untitled = { ...item, structuredData: { ...item.structuredData, title: "" } };
    expect(missingRequirementOf(untitled)).toBe("Name this houseplant.");
  });
});

describe("dates work the same as everywhere else", () => {
  it("resolves a phrase rather than trusting the model", () => {
    const { rpc } = run(customResponse({ datePhrase: "tomorrow" }));
    expect(rpc[0]!.data.due_at).not.toBeNull();
    expect(String(rpc[0]!.data.due_at)).toContain("2026-08-10T21:00");
  });

  it("asks the question when a phrase has two readings", () => {
    const { ambiguities } = run(customResponse({ datePhrase: "next Friday" }));
    expect(ambiguities).toHaveLength(1);
  });
});

describe("dedupe", () => {
  it("keeps two different things of the same new type", () => {
    const first = customResponse({ title: "Monstera" }).items[0]!;
    const second = { ...customResponse({ title: "Fiddle leaf fig" }).items[0]!, temporaryId: "c2" };
    const { items } = run({ items: [first, second] });
    expect(items).toHaveLength(2);
  });

  it("collapses the same thing proposed twice", () => {
    const first = customResponse().items[0]!;
    const second = { ...customResponse().items[0]!, temporaryId: "c2" };
    const { items } = run({ items: [first, second] });
    expect(items).toHaveLength(1);
  });
});
