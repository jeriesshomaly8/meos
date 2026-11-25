import { describe, expect, it } from "vitest";
import { parseExtractionResponse } from "@/lib/extraction/schema";
import { normaliseProposals } from "@/lib/extraction/normalise";
import { missingRequirementOf } from "@/lib/extraction/ambiguity";
import { buildRpcItems } from "@/lib/extraction/to-rpc";
import { isRinging, isMissed, msUntil, snoozeUntil, RING_GRACE_MS, SNOOZE_MINUTES } from "@/lib/alarms/snooze";
import { isoDateInZone, partsInZone } from "@/lib/temporal/zone";

/**
 * Phase 9. Everything here is the deterministic half of an alarm — what time
 * it should ring at and whether it is allowed to be saved at all. The half
 * that cannot be tested here is whether a phone actually wakes anybody up,
 * which is Phase 10 and needs a real device.
 */

const TZ = "Asia/Jerusalem";
const NOW = new Date("2026-08-10T15:30:00Z"); // Mon 10 Aug, 18:30 local
const ctx = { now: NOW, timeZone: TZ };

function alarmResponse(title: string, datePhrase: string | null) {
  return {
    items: [
      {
        temporaryId: "a1",
        category: "alarm",
        action: "create",
        confidence: 0.95,
        summary: title,
        relationships: [],
        missingFields: [],
        sourceText: title,
        structuredData: { title, datePhrase },
      },
    ],
  };
}

function run(raw: unknown) {
  const { items } = parseExtractionResponse(raw);
  const normalised = normaliseProposals(items, ctx);
  const rpc = buildRpcItems(normalised.items.map((item) => ({ item, existingPersonId: null })));
  return { ...normalised, rpc };
}

describe("“Wake me up tomorrow at 7am”", () => {
  const { items, rpc } = run(alarmResponse("Wake up", "tomorrow at 7am"));

  it("is an alarm, not a reminder or a note", () => {
    expect(items[0]!.category).toBe("alarm");
    expect(rpc[0]!.category).toBe("alarm");
  });

  it("rings at 07:00 on the user's tomorrow, not the server's", () => {
    const dueAt = new Date(rpc[0]!.data.due_at as string);
    expect(isoDateInZone(dueAt, TZ)).toBe("2026-08-11");
    expect(partsInZone(dueAt, TZ).hour).toBe(7);
    expect(partsInZone(dueAt, TZ).minute).toBe(0);
  });

  it("is savable, because it has a real time", () => {
    expect(missingRequirementOf(items[0]!)).toBeNull();
  });

  it("keeps the phrase it came from", () => {
    expect(rpc[0]!.data.date_phrase).toBe("tomorrow at 7am");
  });
});

describe("an alarm without a time is blocked, never armed at midnight", () => {
  it("“wake me up tomorrow” keeps the day but asks for the time", () => {
    const { items, rpc } = run(alarmResponse("Wake up", "tomorrow"));
    const item = items[0]!;

    expect(item.category === "alarm" && item.structuredData.resolvedAllDay).toBe(true);
    // The day is known and worth keeping — only the clock time is missing.
    expect(isoDateInZone(new Date(rpc[0]!.data.due_at as string), TZ)).toBe("2026-08-11");
    expect(missingRequirementOf(item)).toBe("Set the time this should ring.");
  });

  it("“wake me up early” has neither day nor time and says so", () => {
    const { items, rpc } = run(alarmResponse("Wake up", "early"));
    expect(rpc[0]!.data.due_at).toBeNull();
    expect(missingRequirementOf(items[0]!)).toBe("Set the day and time this should ring.");
  });

  it("nothing else is ever blocked on a missing field here", () => {
    const { items } = run({
      items: [
        {
          temporaryId: "t1",
          category: "task",
          action: "create",
          confidence: 0.7,
          summary: "Buy milk",
          relationships: [],
          missingFields: [],
          sourceText: "Buy milk",
          structuredData: { title: "Buy milk", notes: null, datePhrase: null },
        },
      ],
    });
    expect(missingRequirementOf(items[0]!)).toBeNull();
  });
});

describe("deduplication treats the time as part of the identity", () => {
  it("two alarms at different times both survive", () => {
    const { items } = run({
      items: [
        alarmResponse("Wake up", "tomorrow at 7am").items[0],
        { ...alarmResponse("Wake up", "tomorrow at 8am").items[0], temporaryId: "a2" },
      ],
    });
    expect(items).toHaveLength(2);
  });

  it("the same alarm proposed twice collapses to one", () => {
    const { items } = run({
      items: [
        alarmResponse("Wake up", "tomorrow at 7am").items[0],
        { ...alarmResponse("Wake up", "tomorrow at 7am").items[0], temporaryId: "a2" },
      ],
    });
    expect(items).toHaveLength(1);
  });
});

describe("snooze arithmetic", () => {
  it("moves the alarm forward by the snooze interval", () => {
    expect(snoozeUntil(NOW).toISOString()).toBe("2026-08-10T15:39:00.000Z");
    expect(msUntil(snoozeUntil(NOW), NOW)).toBe(SNOOZE_MINUTES * 60_000);
  });

  it("is always in the future, which is what the database constraint requires", () => {
    expect(snoozeUntil(NOW).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("crosses a DST boundary without drifting, because it adds to the instant", () => {
    // 26 Oct 2026 01:59 UTC — inside Europe/London's autumn transition.
    const nearTransition = new Date("2026-10-25T00:55:00Z");
    expect(msUntil(snoozeUntil(nearTransition), nearTransition)).toBe(SNOOZE_MINUTES * 60_000);
  });
});

describe("when an alarm should ring", () => {
  const due = new Date("2026-08-11T04:00:00Z");

  it("does not ring before its time", () => {
    expect(isRinging(due, new Date(due.getTime() - 1000))).toBe(false);
  });

  it("rings at its time and through the grace window", () => {
    expect(isRinging(due, due)).toBe(true);
    expect(isRinging(due, new Date(due.getTime() + RING_GRACE_MS))).toBe(true);
  });

  it("stops ringing past the grace window rather than ambushing hours later", () => {
    const late = new Date(due.getTime() + RING_GRACE_MS + 1);
    expect(isRinging(due, late)).toBe(false);
    expect(isMissed(due, late)).toBe(true);
  });

  it("is not 'missed' while it is still ringing", () => {
    expect(isMissed(due, due)).toBe(false);
  });
});
