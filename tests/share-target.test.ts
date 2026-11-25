import { describe, expect, it } from "vitest";
import { CAPTURE_MAX_CHARS } from "@/lib/capture/limits";
import { composeSharedText } from "@/lib/share/shared-text";

/**
 * §6.3 D. Every app fills the three share fields differently, and the only
 * failure that matters is the user seeing the same link twice — or their own
 * title repeated — in the capture box before they've typed a thing.
 */

describe("what lands in the capture box", () => {
  it("keeps a page's title and its link, once each", () => {
    expect(
      composeSharedText({
        title: "The best hummus in Haifa",
        text: "",
        url: "https://example.com/hummus",
      }),
    ).toBe("The best hummus in Haifa\nhttps://example.com/hummus");
  });

  it("drops the URL when the body already contains it", () => {
    // What a "share link" from most Android browsers actually sends.
    expect(
      composeSharedText({
        title: "Recipe",
        text: "Look at this https://example.com/hummus",
        url: "https://example.com/hummus",
      }),
    ).toBe("Recipe\nLook at this https://example.com/hummus");
  });

  it("drops a title the body already opens with", () => {
    expect(
      composeSharedText({ title: "Buy milk", text: "Buy milk and bread", url: "" }),
    ).toBe("Buy milk and bread");
  });

  it("passes a bare message through untouched", () => {
    expect(composeSharedText({ text: "Dana's birthday is 3 March" })).toBe(
      "Dana's birthday is 3 March",
    );
  });

  it("is empty when the share was", () => {
    expect(composeSharedText({})).toBe("");
    expect(composeSharedText({ title: "  ", text: null, url: undefined })).toBe("");
  });

  it("never exceeds what the capture box and /api/analyze accept", () => {
    const shared = composeSharedText({ text: "x".repeat(CAPTURE_MAX_CHARS + 500) });
    expect(shared).toHaveLength(CAPTURE_MAX_CHARS);
  });

  it("normalises the line endings a Windows share sends", () => {
    expect(composeSharedText({ text: "one\r\ntwo" })).toBe("one\ntwo");
  });
});
