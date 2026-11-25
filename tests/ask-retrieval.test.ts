import { describe, expect, it } from "vitest";
import {
  ilikeAnyOf,
  refOf,
  resolveCitations,
  searchTerms,
  type AskSource,
} from "@/lib/ask/retrieval";

/**
 * The deterministic half of Ask's targeted retrieval (§Phase 6). The model
 * call is the only piece not exercised: term extraction decides what is
 * retrieved, and citation resolution decides what the user is shown as
 * sources — both places where a wrong answer would be silent.
 */

describe("searchTerms", () => {
  it("keeps the words that select rows and drops the question scaffolding", () => {
    expect(searchTerms("When does my passport expire?")).toEqual(["passport", "expire"]);
    expect(searchTerms("What food does Sarah dislike?")).toEqual(["food", "sarah", "dislike"]);
  });

  it("returns nothing for a purely temporal question — the anchors answer those", () => {
    expect(searchTerms("What's coming up next month?")).toEqual([]);
  });

  it("keeps names in any script", () => {
    expect(searchTerms("מתי יום ההולדת של דנה?")).toContain("דנה");
  });

  it("dedupes and caps, so a rambling question cannot explode the filter", () => {
    expect(searchTerms("passport passport passport")).toEqual(["passport"]);
    const many = searchTerms("alpha bravo charlie delta echo foxtrot golf hotel india juliet");
    expect(many).toHaveLength(8);
  });

  it("strips everything that could break a PostgREST filter", () => {
    for (const term of searchTerms("weird, (question). with%under_scores and.dots")) {
      expect(term).toMatch(/^[\p{L}\p{N}]+$/u);
    }
  });
});

describe("ilikeAnyOf", () => {
  it("matches any term in any column", () => {
    expect(ilikeAnyOf(["title", "summary"], ["milk"])).toBe(
      "title.ilike.*milk*,summary.ilike.*milk*",
    );
  });

  it("is null when there is nothing to match — the caller skips the query", () => {
    expect(ilikeAnyOf(["title"], [])).toBeNull();
    expect(ilikeAnyOf([], ["milk"])).toBeNull();
  });
});

describe("resolveCitations", () => {
  const passport: AskSource = { ref: refOf("documents", "d1"), kind: "document", label: "Passport" };
  const dana: AskSource = { ref: refOf("people", "p1"), kind: "person", label: "Dana" };
  const known = new Map([
    [passport.ref, passport],
    [dana.ref, dana],
  ]);

  it("maps refs onto retrieved records, in the model's order", () => {
    expect(resolveCitations(["people:p1", "documents:d1"], known)).toEqual([dana, passport]);
  });

  it("drops an invented ref instead of rendering it", () => {
    expect(resolveCitations(["documents:d1", "documents:made-up"], known)).toEqual([passport]);
  });

  it("drops duplicates and non-strings, and survives a non-array", () => {
    expect(resolveCitations(["people:p1", "people:p1", 42, null], known)).toEqual([dana]);
    expect(resolveCitations("people:p1", known)).toEqual([]);
    expect(resolveCitations(undefined, known)).toEqual([]);
  });

  it("caps at eight sources", () => {
    const lots = new Map<string, AskSource>();
    const refs: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const ref = refOf("notes", `n${i}`);
      lots.set(ref, { ref, kind: "note", label: `Note ${i}` });
      refs.push(ref);
    }
    expect(resolveCitations(refs, lots)).toHaveLength(8);
  });
});
