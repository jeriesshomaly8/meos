import { describe, expect, it } from "vitest";
import { parseExtractionResponse } from "@/lib/extraction/schema";
import { normaliseProposals } from "@/lib/extraction/normalise";
import { buildRpcItems } from "@/lib/extraction/to-rpc";
import { missingRequirementOf } from "@/lib/extraction/ambiguity";
import { isoDateInZone } from "@/lib/temporal/zone";
import type { ItemType } from "@/lib/items/types";

/**
 * The three seeded memory types (migration 0015): where things are, who has
 * what, what size everyone takes. They ride the existing custom-type path —
 * what these tests pin is that a proposal with the seeded key lands on the
 * core type instead of creating a per-user duplicate, and that the facts
 * survive to the RPC payload.
 */

const TZ = "Asia/Jerusalem";
const NOW = new Date("2026-08-10T15:30:00Z"); // Mon 10 Aug, 18:30 local

/** The rows migration 0015 seeds, as the analyze route would load them. */
const seededType = (key: string, singular: string, plural: string): ItemType => ({
  key,
  singular,
  plural,
  icon: "map-pin",
  color: "neutral",
  kind: "core",
  defaultCapability: "record",
  fieldSchema: [],
  hidden: false,
  mergedInto: null,
});

const existingTypes = [
  seededType("belonging", "Belonging", "Belongings"),
  seededType("loan", "Loan", "Loans"),
  seededType("size", "Size", "Sizes"),
];

const ctx = { now: NOW, timeZone: TZ, existingTypes };

function customProposal(
  temporaryId: string,
  typeKey: string,
  names: { singular: string; plural: string },
  title: string,
  attributes: { key: string; value: string }[],
  extra: Record<string, unknown> = {},
) {
  return {
    temporaryId,
    category: "custom",
    action: "create",
    confidence: 0.9,
    summary: title,
    relationships: [],
    missingFields: [],
    sourceText: title,
    structuredData: {
      typeKey,
      singular: names.singular,
      plural: names.plural,
      icon: "map-pin",
      color: "neutral",
      title,
      datePhrase: null,
      attributes,
    },
    ...extra,
  };
}

function run(items: unknown[]) {
  const parsed = parseExtractionResponse({ items });
  const normalised = normaliseProposals(parsed.items, ctx);
  const rpc = buildRpcItems(normalised.items.map((item) => ({ item, existingPersonId: null })));
  return { items: normalised.items, rpc };
}

describe("“The spare key is in the blue box on the top shelf”", () => {
  const { items, rpc } = run([
    customProposal(
      "b1",
      "belonging",
      { singular: "Belonging", plural: "Belongings" },
      "Spare key",
      [{ key: "location", value: "in the blue box on the top shelf" }],
    ),
  ]);

  it("files under the seeded core type instead of proposing a new one", () => {
    const item = items[0]!;
    if (item.category !== "custom") throw new Error("wrong category");
    expect(item.structuredData.reusedTypeKey).toBe("belonging");
  });

  it("keeps the location as a queryable fact", () => {
    expect(rpc[0]!.data.type_key).toBe("belonging");
    expect((rpc[0]!.data.attributes as Record<string, string>).location).toBe(
      "in the blue box on the top shelf",
    );
    expect(missingRequirementOf(items[0]!)).toBeNull();
  });
});

describe("“I lent the drill to Yossi” with its come-back nudge", () => {
  const { items, rpc } = run([
    customProposal(
      "l1",
      "loan",
      { singular: "Loan", plural: "Loans" },
      "Drill",
      [
        { key: "direction", value: "lent" },
        { key: "who", value: "Yossi" },
      ],
      { relationships: ["r1"] },
    ),
    {
      temporaryId: "r1",
      category: "reminder",
      action: "create",
      confidence: 0.85,
      summary: "Yossi still has the drill",
      relationships: ["l1"],
      missingFields: [],
      sourceText: "I lent the drill to Yossi",
      structuredData: {
        title: "Yossi still has the drill",
        datePhrase: "in one month",
        relatedRef: "l1",
        relatedEntityType: null,
        notes: null,
      },
    },
  ]);

  it("records who has it and which way the loan runs", () => {
    const loan = rpc.find((r) => r.category === "custom")!;
    const attributes = loan.data.attributes as Record<string, string>;
    expect(loan.data.type_key).toBe("loan");
    expect(attributes.who).toBe("Yossi");
    expect(attributes.direction).toBe("lent");
  });

  it("arms the nudge a month out, resolved by the app and not the model", () => {
    const reminder = rpc.find((r) => r.category === "reminder")!;
    expect(isoDateInZone(new Date(reminder.data.remind_at as string), TZ)).toBe("2026-09-10");
    expect(missingRequirementOf(items.find((i) => i.category === "reminder")!)).toBeNull();
  });
});

describe("“Dana's shoe size is 38”", () => {
  const { items, rpc } = run([
    customProposal(
      "s1",
      "size",
      { singular: "Size", plural: "Sizes" },
      "Dana's shoe size",
      [
        { key: "person", value: "Dana" },
        { key: "kind", value: "shoe" },
        { key: "value", value: "38" },
      ],
    ),
  ]);

  it("files under the seeded size type with the number as a fact", () => {
    const item = items[0]!;
    if (item.category !== "custom") throw new Error("wrong category");
    expect(item.structuredData.reusedTypeKey).toBe("size");
    expect((rpc[0]!.data.attributes as Record<string, string>).value).toBe("38");
  });
});

describe("a genuinely new kind of thing is untouched by the seeds", () => {
  const { items } = run([
    customProposal(
      "h1",
      "houseplant",
      { singular: "Houseplant", plural: "Houseplants" },
      "Monstera",
      [{ key: "location", value: "by the window" }],
    ),
  ]);

  it("still proposes a brand-new type", () => {
    const item = items[0]!;
    if (item.category !== "custom") throw new Error("wrong category");
    expect(item.structuredData.reusedTypeKey).toBeNull();
  });
});
