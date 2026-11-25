import { describe, expect, it } from "vitest";
import { CONVERSION_TARGETS, convertCategory } from "@/lib/extraction/convert";
import { missingRequirementOf, TEXT_REQUIREMENTS } from "@/lib/extraction/ambiguity";
import { extractedItemSchema, parseExtractionResponse } from "@/lib/extraction/schema";
import { normaliseProposals } from "@/lib/extraction/normalise";
import { buildRpcItems } from "@/lib/extraction/to-rpc";
import { isoDateInZone } from "@/lib/temporal/zone";

/**
 * Type correction on the confirmation sheet (§Phase 4). What must hold:
 * the output is schema-valid (the save route re-parses it), temporaryId never
 * moves (it is the React key and the relationship reference), dates survive
 * between dated categories, and anything the target requires that the source
 * cannot supply is blocked by name — never invented.
 */

const TZ = "Asia/Jerusalem";
const NOW = new Date("2026-08-10T15:30:00Z"); // Mon 10 Aug, 18:30 local
const ctx = { now: NOW, timeZone: TZ };

function pipelineItem(category: string, structuredData: Record<string, unknown>) {
  const { items } = parseExtractionResponse({
    items: [
      {
        temporaryId: "keep-me",
        category,
        action: "create",
        confidence: 0.9,
        summary: "the original summary",
        relationships: ["other-1"],
        missingFields: [],
        sourceText: "buy milk next friday",
        structuredData,
      },
    ],
  });
  return normaliseProposals(items, ctx).items[0]!;
}

const task = pipelineItem("task", { title: "Buy milk", notes: "semi-skimmed", datePhrase: "tomorrow" });
const note = pipelineItem("note", {
  title: null,
  content: "Call the dentist about the crown",
  noteType: "general",
});

describe("what every conversion preserves", () => {
  /*
   * The invariant is not "always schema-valid" — a target can require what the
   * source cannot supply (a document's type), and inventing it would be worse.
   * It is: schema-valid, OR blocked by a named requirement so the user can
   * never reach the save route's 400.
   */
  it.each(CONVERSION_TARGETS.filter((t) => t !== "task"))(
    "task → %s is valid or blocked by name",
    (to) => {
      const converted = convertCategory(task, to, ctx);
      expect(converted.category).toBe(to);
      expect(converted.temporaryId).toBe("keep-me");
      expect(converted.relationships).toEqual(["other-1"]);
      const valid = extractedItemSchema.safeParse(converted).success;
      expect(valid || missingRequirementOf(converted) !== null).toBe(true);
    },
  );

  it("converting to the same category is the same item", () => {
    expect(convertCategory(task, "task", ctx)).toBe(task);
  });
});

describe("note → task", () => {
  const converted = convertCategory(note, "task", ctx);

  it("uses the note's content as the thing to do", () => {
    if (converted.category !== "task") throw new Error("wrong category");
    expect(converted.structuredData.title).toBe("Call the dentist about the crown");
    expect(missingRequirementOf(converted)).toBeNull();
  });
});

describe("task → note", () => {
  const converted = convertCategory(task, "note", ctx);

  it("keeps the user's own words as the content", () => {
    if (converted.category !== "note") throw new Error("wrong category");
    expect(converted.structuredData.content).toBe("buy milk next friday");
  });
});

describe("task → reminder", () => {
  const converted = convertCategory(task, "reminder", ctx);

  it("carries the phrase and its resolution, so the date survives the correction", () => {
    if (converted.category !== "reminder") throw new Error("wrong category");
    expect(converted.structuredData.datePhrase).toBe("tomorrow");
    expect(converted.structuredData.resolvedDueAt).not.toBeNull();
    expect(missingRequirementOf(converted)).toBeNull();
  });

  it("lands in the reminder branch of the RPC payload", () => {
    const rpc = buildRpcItems([{ item: converted, existingPersonId: null }]);
    expect(rpc[0]!.category).toBe("reminder");
    expect(rpc[0]!.data.remind_at).not.toBeNull();
  });
});

describe("an unanswered date question survives a dated → dated correction", () => {
  const ambiguous = pipelineItem("task", {
    title: "Collect the parcel",
    notes: null,
    datePhrase: "next Friday",
  });
  const converted = convertCategory(ambiguous, "reminder", ctx);

  it("keeps the ambiguity, so the save stays gated until the user answers", () => {
    if (converted.category !== "reminder") throw new Error("wrong category");
    expect(converted.structuredData.dateAmbiguity).not.toBeNull();
    expect(converted.structuredData.resolvedDueAt).toBeNull();
  });
});

describe("task → list", () => {
  const converted = convertCategory(task, "list", ctx);

  it("starts empty and is blocked by name until a row exists", () => {
    if (converted.category !== "list") throw new Error("wrong category");
    expect(converted.structuredData.items).toEqual([]);
    expect(missingRequirementOf(converted)).toBe(TEXT_REQUIREMENTS.listRows);
  });

  it("re-derives the summary, because the old sentence no longer follows the data", () => {
    expect(converted.summary).toBe("Empty list");
  });
});

describe("task → important_date", () => {
  const converted = convertCategory(task, "important_date", ctx);

  it("reads the resolved instant as the user's local day, never UTC's", () => {
    if (converted.category !== "important_date") throw new Error("wrong category");
    // "tomorrow" at a Jerusalem evening is the 11th there; UTC truncation
    // would also say the 11th here, but the assertion pins the zone path.
    expect(converted.structuredData.eventDate).toBe(
      isoDateInZone(new Date("2026-08-11T00:00:00+03:00"), TZ),
    );
  });
});

describe("task → document", () => {
  const converted = convertCategory(task, "document", ctx);

  it("never invents a document type — it is seeded blank and blocked by name", () => {
    if (converted.category !== "document") throw new Error("wrong category");
    expect(converted.structuredData.documentType).toBe("");
    expect(missingRequirementOf(converted)).toBe(TEXT_REQUIREMENTS.documentType);
  });

  it("reads the task's date as the expiry, visibly", () => {
    if (converted.category !== "document") throw new Error("wrong category");
    expect(converted.structuredData.expiryPhrase).toBe("tomorrow");
    expect(converted.structuredData.expirationDate).toBe("2026-08-11");
  });
});

describe("person → task", () => {
  const person = pipelineItem("person", {
    name: "Dana",
    relationship: "sister",
    birthdayPhrase: null,
    notes: "moving house soon",
    generalPreferences: [],
  });
  const converted = convertCategory(person, "task", ctx);

  it("maps the name across and keeps the notes", () => {
    if (converted.category !== "task") throw new Error("wrong category");
    expect(converted.structuredData.title).toBe("Dana");
    expect(converted.structuredData.notes).toBe("moving house soon");
  });
});

describe("custom → note (leaving a type proposal)", () => {
  const custom = pipelineItem("custom", {
    typeKey: "houseplant",
    singular: "Houseplant",
    plural: "Houseplants",
    icon: "leaf",
    color: "success",
    title: "Monstera",
    datePhrase: null,
    attributes: [{ key: "location", value: "by the window" }],
  });
  const converted = convertCategory(custom, "note", ctx);

  it("keeps the user's words; the type proposal simply never happens", () => {
    if (converted.category !== "note") throw new Error("wrong category");
    expect(converted.structuredData.content).toBe("buy milk next friday");
    expect(extractedItemSchema.safeParse(converted).success).toBe(true);
  });

  it("does not offer custom as a target", () => {
    expect(CONVERSION_TARGETS).not.toContain("custom");
  });
});
