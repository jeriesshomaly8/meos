import { CATEGORY_META } from "@/lib/categories";
import type { ExtractedItem } from "./schema";

/**
 * Saying what MeOS found, instead of how many things it found.
 *
 * §1.8: "MeOS picked out 3 things" and "Saved 3 things" both restate a number
 * the user can already see by counting the cards. The useful sentence names
 * the *content* — "a task, two people and a shopping list" — because that is
 * the thing they are about to approve and cannot otherwise check at a glance.
 */

/** Small counts read as words; past that a numeral is easier to scan. */
const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

function count(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/** "a task", "an alarm" — chosen by sound, which for these labels means vowels. */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

/**
 * What a single item calls itself.
 *
 * A custom type uses its own name rather than the "New type" fallback in
 * `CATEGORY_META`: the user proposed "Houseplant", and being told they saved
 * "a new type" would be the same restating-the-category failure in a new coat.
 */
function labelsFor(item: ExtractedItem): { singular: string; plural: string } {
  if (item.category === "custom") {
    return {
      singular: item.structuredData.singular.toLowerCase(),
      plural: item.structuredData.plural.toLowerCase(),
    };
  }
  const meta = CATEGORY_META[item.category];
  return { singular: meta.label.toLowerCase(), plural: meta.pluralLabel.toLowerCase() };
}

/** "a, b and c" — the Oxford comma is omitted deliberately; this is en-GB copy. */
function joinWithAnd(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * "a task, two people and a shopping list".
 *
 * Groups by what the thing *is*, in the order the categories first appear, so
 * the sentence reads in the same order as the cards below it.
 */
export function describeItems(items: ExtractedItem[]): string {
  if (items.length === 0) return "nothing";

  const groups = new Map<string, { singular: string; plural: string; n: number }>();
  for (const item of items) {
    const { singular, plural } = labelsFor(item);
    const existing = groups.get(singular);
    if (existing) existing.n += 1;
    else groups.set(singular, { singular, plural, n: 1 });
  }

  const parts = [...groups.values()].map(({ singular, plural, n }) =>
    n === 1 ? `${article(singular)} ${singular}` : `${count(n)} ${plural}`,
  );
  return joinWithAnd(parts);
}

/**
 * What is actually uncertain about a low-confidence item.
 *
 * §1.8: "worth a check" says nothing about *what* to check, so the user has to
 * open the card to find out — which is the work the label was supposed to save
 * them. Two things can be shaky and they need different sentences: a field the
 * user never supplied, or the classification itself.
 */
export function uncertaintyHint(item: ExtractedItem): string {
  const missing = item.missingFields[0];
  if (missing) {
    const readable = missing
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .toLowerCase();
    return `no ${readable}`;
  }
  const { singular } = labelsFor(item);
  return `check it's ${article(singular)} ${singular}`;
}

/** Sentence-cased for the places that open with it. */
export function describeItemsCapitalised(items: ExtractedItem[]): string {
  const described = describeItems(items);
  return described.charAt(0).toUpperCase() + described.slice(1);
}
