import { describe, expect, it } from "vitest";
import { MAX_IMPORTED_CONTACTS, normaliseContactNames } from "@/lib/contacts/picker";

/**
 * §6.3 G. The picker itself is the OS's job; the only thing MeOS owns is what
 * it does with the names that come back — and an address book is messier than
 * anyone remembers until it becomes rows in a table.
 */

describe("names coming back from the OS picker", () => {
  it("tidies whitespace without changing the name", () => {
    expect(normaliseContactNames(["  Dana   Levi  "])).toEqual(["Dana Levi"]);
  });

  it("skips the blank entries an address book is full of", () => {
    expect(normaliseContactNames(["Dana", "", "   ", null, undefined, "Yossi"])).toEqual([
      "Dana",
      "Yossi",
    ]);
  });

  it("keeps one row when the same person is ticked twice", () => {
    expect(normaliseContactNames(["Dana Levi", "dana levi", "DANA LEVI"])).toEqual(["Dana Levi"]);
  });

  it("adds only what isn't saved already, whatever the capitalisation", () => {
    // A second import should be additive, not a pile of duplicates.
    expect(normaliseContactNames(["Dana", "Yossi"], ["dana"])).toEqual(["Yossi"]);
  });

  it("stops at the batch limit rather than importing an entire phone", () => {
    const everyone = Array.from({ length: 200 }, (_, index) => `Person ${index}`);
    expect(normaliseContactNames(everyone)).toHaveLength(MAX_IMPORTED_CONTACTS);
  });

  it("truncates a name too long for the people table", () => {
    expect(normaliseContactNames(["N".repeat(200)])[0]).toHaveLength(80);
  });

  it("returns nothing when nobody was picked", () => {
    expect(normaliseContactNames([])).toEqual([]);
  });
});
