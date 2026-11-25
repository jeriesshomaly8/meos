import { describe, expect, it } from "vitest";
import { passportNotice } from "@/lib/trips/passport-check";
import { parseExtractionResponse } from "@/lib/extraction/schema";
import { normaliseProposals } from "@/lib/extraction/normalise";
import { buildRpcItems } from "@/lib/extraction/to-rpc";
import { isoDateInZone } from "@/lib/temporal/zone";
import type { ItemType } from "@/lib/items/types";

/**
 * Trip brain (§v2.1): the passport warning happens at capture time, when
 * rebooking is cheap — not at the airport. The check itself is arithmetic
 * over what the user stored; the copy says "many countries", never "yours
 * does", because the rule genuinely varies.
 */

const TZ = "Asia/Jerusalem";
const NOW = new Date("2026-08-10T15:30:00Z"); // Mon 10 Aug, 18:30 local

const TRIP_TYPE: ItemType = {
  key: "trip",
  singular: "Trip",
  plural: "Trips",
  icon: "plane",
  color: "accent",
  kind: "core",
  defaultCapability: "record",
  fieldSchema: [],
  hidden: false,
  mergedInto: null,
};

const ctx = { now: NOW, timeZone: TZ, existingTypes: [TRIP_TYPE] };

describe("passportNotice", () => {
  const passport = (expiry: string) => [{ display_name: "Passport", expiration_date: expiry }];

  it("says nothing when the passport comfortably outlives the trip", () => {
    expect(passportNotice("2026-10-10", passport("2028-05-14"))).toBeNull();
  });

  it("warns when expiry lands inside the six months after the trip", () => {
    const notice = passportNotice("2026-10-10", passport("2027-01-10"))!;
    expect(notice).toContain("less than six months");
    expect(notice).toContain("10 Jan 2027");
  });

  it("escalates when the passport dies before the trip does", () => {
    const notice = passportNotice("2026-10-10", passport("2026-10-05"))!;
    expect(notice).toContain("before this trip ends");
  });

  it("names the soonest-expiring passport when there are several", () => {
    const notice = passportNotice("2026-10-10", [
      { display_name: "New passport", expiration_date: "2036-01-01" },
      { display_name: "Old passport", expiration_date: "2026-12-01" },
    ])!;
    expect(notice).toContain("Old passport");
  });

  it("stays silent with no passports on file — no data is not a warning", () => {
    expect(passportNotice("2026-10-10", [])).toBeNull();
  });
});

describe("“We're going to Rome 3rd to 10th October”", () => {
  const { items } = parseExtractionResponse({
    items: [
      {
        temporaryId: "trip-1",
        category: "custom",
        action: "create",
        confidence: 0.93,
        summary: "Trip to Rome, 3–10 October",
        relationships: [],
        missingFields: [],
        sourceText: "we're going to Rome 3rd to 10th October",
        structuredData: {
          typeKey: "trip",
          singular: "Trip",
          plural: "Trips",
          icon: "plane",
          color: "accent",
          title: "Rome",
          datePhrase: "3rd October",
          attributes: [
            { key: "destination", value: "Rome" },
            { key: "until", value: "10th October" },
          ],
        },
      },
    ],
  });
  const normalised = normaliseProposals(items, ctx);
  const rpc = buildRpcItems(normalised.items.map((item) => ({ item, existingPersonId: null })));

  it("files under the seeded trip type", () => {
    const item = normalised.items[0]!;
    if (item.category !== "custom") throw new Error("wrong category");
    expect(item.structuredData.reusedTypeKey).toBe("trip");
  });

  it("resolves the start into the user's calendar", () => {
    expect(isoDateInZone(new Date(rpc[0]!.data.due_at as string), TZ)).toBe("2026-10-03");
  });

  it("resolves `until` from words into a checkable date", () => {
    expect((rpc[0]!.data.attributes as Record<string, string>).until).toBe("2026-10-10");
  });

  it("leaves unresolvable words as words — still true, just not checkable", () => {
    const { items: vague } = parseExtractionResponse({
      items: [
        {
          temporaryId: "trip-2",
          category: "custom",
          action: "create",
          confidence: 0.9,
          summary: "Trip",
          relationships: [],
          missingFields: [],
          sourceText: "rome sometime in autumn",
          structuredData: {
            typeKey: "trip",
            singular: "Trip",
            plural: "Trips",
            icon: "plane",
            color: "accent",
            title: "Rome",
            datePhrase: null,
            attributes: [{ key: "until", value: "sometime in autumn" }],
          },
        },
      ],
    });
    const out = normaliseProposals(vague, ctx).items[0]!;
    if (out.category !== "custom") throw new Error("wrong category");
    expect(out.structuredData.resolvedAttributes.until).toBe("sometime in autumn");
  });
});
