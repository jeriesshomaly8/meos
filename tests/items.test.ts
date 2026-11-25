import { describe, expect, it } from "vitest";
import {
  MAX_ATTRIBUTE_KEYS,
  attributesSchema,
  sanitiseAttributes,
} from "@/lib/items/attributes";
import {
  findReusableType,
  normaliseTypeKey,
  typeProposalSchema,
  type ItemType,
} from "@/lib/items/types";

describe("attribute guard", () => {
  it("accepts scalars and flat arrays", () => {
    const result = attributesSchema.safeParse({
      dose_mg: 1000,
      brand: "Vitamin D3",
      daily: true,
      taken_with: ["breakfast", "water"],
      stopped_on: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects nested objects, matching the SQL constraint", () => {
    expect(attributesSchema.safeParse({ a: { b: 1 } }).success).toBe(false);
    expect(attributesSchema.safeParse({ a: [{ b: 1 }] }).success).toBe(false);
  });

  it("rejects keys that are not snake_case", () => {
    expect(attributesSchema.safeParse({ "Bad Key": 1 }).success).toBe(false);
    expect(attributesSchema.safeParse({ _leading: 1 }).success).toBe(false);
    expect(attributesSchema.safeParse({ "9lives": 1 }).success).toBe(false);
  });

  it("caps the number of keys", () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: MAX_ATTRIBUTE_KEYS + 1 }, (_, i) => [`k${i}`, i]),
    );
    expect(attributesSchema.safeParse(tooMany).success).toBe(false);
  });
});

describe("attribute sanitiser", () => {
  it("normalises loose keys the model tends to emit", () => {
    const { attributes, dropped } = sanitiseAttributes({
      "Dose MG": 1000,
      "taken-with": "breakfast",
    });
    expect(attributes).toEqual({ dose_mg: 1000, taken_with: "breakfast" });
    expect(dropped).toEqual([]);
  });

  it("drops only the offending attribute, keeping the rest of the item", () => {
    const { attributes, dropped } = sanitiseAttributes({
      brand: "Acme",
      nested: { not: "allowed" },
      count: 3,
    });
    expect(attributes).toEqual({ brand: "Acme", count: 3 });
    expect(dropped).toEqual(["nested"]);
  });

  it("reports oversized payloads instead of silently truncating in the database", () => {
    const { attributes, dropped } = sanitiseAttributes({
      keep: "small",
      huge: "x".repeat(20_000),
    });
    expect(dropped).toContain("huge");
    expect(attributes.keep).toBe("small");
  });

  it("returns an empty object for non-objects", () => {
    expect(sanitiseAttributes(null).attributes).toEqual({});
    expect(sanitiseAttributes(["a"]).attributes).toEqual({});
    expect(sanitiseAttributes("text").attributes).toEqual({});
  });
});

describe("type keys", () => {
  it("collapses spellings that mean the same type", () => {
    expect(normaliseTypeKey("Gift Ideas")).toBe("gift_idea");
    expect(normaliseTypeKey("gift-idea")).toBe("gift_idea");
    expect(normaliseTypeKey("Medications")).toBe("medication");
    expect(normaliseTypeKey("Groceries")).toBe("grocery");
    expect(normaliseTypeKey("  Home   Maintenance  ")).toBe("home_maintenance");
  });

  it("leaves already-singular keys alone", () => {
    expect(normaliseTypeKey("vehicle")).toBe("vehicle");
    expect(normaliseTypeKey("address")).toBe("address");
  });
});

describe("type reuse", () => {
  const existing: ItemType[] = [
    {
      key: "medication",
      singular: "Medication",
      plural: "Medications",
      icon: "pill",
      color: "neutral",
      kind: "custom",
      defaultCapability: "record",
      fieldSchema: [],
      hidden: false,
      mergedInto: null,
    },
  ];

  const proposal = (over: Partial<Record<string, unknown>> = {}) =>
    typeProposalSchema.parse({
      key: "medications",
      singular: "Medications",
      plural: "Medications",
      icon: "pill",
      color: "neutral",
      defaultCapability: "record",
      fieldSchema: [],
      ...over,
    });

  it("reuses an existing type instead of creating a near-duplicate", () => {
    expect(findReusableType(proposal(), existing)?.key).toBe("medication");
  });

  it("matches on the display name when the key differs", () => {
    const match = findReusableType(
      proposal({ key: "meds", singular: "Medication", plural: "Medications" }),
      existing,
    );
    expect(match?.key).toBe("medication");
  });

  it("creates a genuinely new type", () => {
    expect(findReusableType(proposal({ key: "vehicle", singular: "Vehicle", plural: "Vehicles" }), existing)).toBeNull();
  });

  it("rejects a proposal using an icon outside the approved set", () => {
    const result = typeProposalSchema.safeParse({
      key: "vehicle",
      singular: "Vehicle",
      plural: "Vehicles",
      icon: "skull-and-crossbones",
      color: "neutral",
      defaultCapability: "record",
    });
    expect(result.success).toBe(false);
  });
});
