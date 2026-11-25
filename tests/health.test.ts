import { describe, expect, it } from "vitest";
import { advancedDueAt, describeRrule, parseRrule } from "@/lib/temporal/recurrence";
import { resolveRecurringPhrase } from "@/lib/temporal/resolve";
import { parseExtractionResponse } from "@/lib/extraction/schema";
import { normaliseProposals } from "@/lib/extraction/normalise";
import { buildRpcItems } from "@/lib/extraction/to-rpc";
import { isoDateInZone, partsInZone } from "@/lib/temporal/zone";
import type { ItemType } from "@/lib/items/types";

/**
 * Health & meds (§v2.1). The mechanic under test: a bounded course —
 * "twice a day for 10 days" — whose rules carry UNTIL, so the last tick has
 * no next occurrence and the nagging ends with the course. Nothing here is
 * medical logic; it is bookkeeping about what the user said.
 */

const TZ = "Asia/Jerusalem";
const NOW = new Date("2026-08-10T15:30:00Z"); // Mon 10 Aug, 18:30 local

const seeded = (key: string, singular: string, plural: string): ItemType => ({
  key,
  singular,
  plural,
  icon: "pill",
  color: "date",
  kind: "core",
  defaultCapability: "record",
  fieldSchema: [],
  hidden: false,
  mergedInto: null,
});

const ctx = {
  now: NOW,
  timeZone: TZ,
  existingTypes: [
    seeded("medication", "Medication", "Medications"),
    seeded("vaccination", "Vaccination", "Vaccinations"),
    seeded("health_note", "Health note", "Health notes"),
  ],
};

describe("a bounded rule", () => {
  it("parses UNTIL and refuses a malformed one", () => {
    expect(parseRrule("FREQ=DAILY;UNTIL=20260820T060000Z")!.until).toEqual(
      new Date("2026-08-20T06:00:00Z"),
    );
    expect(parseRrule("FREQ=DAILY;UNTIL=2026-08-20")).toBeNull();
  });

  it("reads on the card with its end date", () => {
    expect(describeRrule("FREQ=DAILY;UNTIL=20260820T060000Z", TZ)).toBe("every day until 20 Aug");
  });

  it("stops advancing past the end — the last tick finishes for good", () => {
    const rule = "FREQ=DAILY;UNTIL=20260812T060000Z";
    const secondDose = new Date("2026-08-11T06:00:00Z");
    const next = advancedDueAt(rule, secondDose, secondDose, TZ)!;
    expect(isoDateInZone(next, TZ)).toBe("2026-08-12");
    // Ticking the 12th's dose: nothing follows. setItemDone falls through to
    // ordinary completion and the task is done, not rescheduled.
    expect(advancedDueAt(rule, next, next, TZ)).toBeNull();
  });
});

describe("“every morning for 10 days”", () => {
  const r = resolveRecurringPhrase("every morning for 10 days", {
    now: NOW,
    timeZone: TZ,
  })!;

  it("first dose tomorrow morning at 9", () => {
    expect(isoDateInZone(r.firstInstant, TZ)).toBe("2026-08-11");
    expect(partsInZone(r.firstInstant, TZ).hour).toBe(9);
  });

  it("carries an UNTIL that allows exactly ten mornings", () => {
    const rule = parseRrule(r.rrule)!;
    expect(rule.until).not.toBeNull();
    // Ten inclusive days from 11 Aug is 20 Aug — the 21st must be outside.
    let occurrence: Date | null = r.firstInstant;
    let count = 1;
    while (occurrence) {
      occurrence = advancedDueAt(r.rrule, occurrence, occurrence, TZ);
      if (occurrence) count += 1;
    }
    expect(count).toBe(10);
  });
});

describe("the full prescription, decomposed as the prompt instructs", () => {
  const raw = {
    items: [
      {
        temporaryId: "m1",
        category: "custom",
        action: "create",
        confidence: 0.92,
        summary: "Amoxicillin, 500mg twice a day for 10 days",
        relationships: ["t1", "t2"],
        missingFields: [],
        sourceText: "amoxicillin 500mg twice a day for 10 days",
        structuredData: {
          typeKey: "medication",
          singular: "Medication",
          plural: "Medications",
          icon: "pill",
          color: "date",
          title: "Amoxicillin",
          datePhrase: null,
          attributes: [
            { key: "dose", value: "500mg" },
            { key: "schedule", value: "twice a day" },
            { key: "course", value: "10 days" },
          ],
        },
      },
      ...["every morning for 10 days", "every evening for 10 days"].map((phrase, i) => ({
        temporaryId: `t${i + 1}`,
        category: "task",
        action: "create",
        confidence: 0.9,
        summary: "Take amoxicillin",
        relationships: ["m1"],
        missingFields: [],
        sourceText: "amoxicillin 500mg twice a day for 10 days",
        structuredData: { title: "Take amoxicillin", notes: null, datePhrase: phrase },
      })),
    ],
  };

  const { items } = parseExtractionResponse(raw);
  const normalised = normaliseProposals(items, ctx);
  const rpc = buildRpcItems(normalised.items.map((item) => ({ item, existingPersonId: null })));

  it("files the medication under the seeded type with its facts", () => {
    const med = rpc.find((r) => r.category === "custom")!;
    expect(med.data.type_key).toBe("medication");
    expect((med.data.attributes as Record<string, string>).dose).toBe("500mg");
  });

  it("arms two bounded daily tasks — morning and evening", () => {
    const tasks = rpc.filter((r) => r.category === "task");
    expect(tasks).toHaveLength(2);
    for (const task of tasks) {
      expect(task.data.rrule).toMatch(/^FREQ=DAILY;UNTIL=/);
    }
    const hours = tasks
      .map((t) => partsInZone(new Date(t.data.due_at as string), TZ).hour)
      .sort((a, b) => a - b);
    expect(hours).toEqual([9, 18]);
  });
});

describe("“I had a tetanus shot today”", () => {
  const { items } = parseExtractionResponse({
    items: [
      {
        temporaryId: "v1",
        category: "custom",
        action: "create",
        confidence: 0.95,
        summary: "Tetanus shot",
        relationships: [],
        missingFields: [],
        sourceText: "had a tetanus shot today",
        structuredData: {
          typeKey: "vaccination",
          singular: "Vaccination",
          plural: "Vaccinations",
          icon: "stethoscope",
          color: "success",
          title: "Tetanus shot",
          datePhrase: "today",
          attributes: [{ key: "against", value: "tetanus" }],
        },
      },
    ],
  });
  const normalised = normaliseProposals(items, ctx);
  const rpc = buildRpcItems(normalised.items.map((item) => ({ item, existingPersonId: null })));

  it("records when it happened, in the user's day — the answer to “when did I last…”", () => {
    expect(rpc[0]!.data.type_key).toBe("vaccination");
    expect(isoDateInZone(new Date(rpc[0]!.data.due_at as string), TZ)).toBe("2026-08-10");
  });
});
