import type { ExtractionCategory } from "@/lib/categories";
import { isoDateInZone } from "@/lib/temporal/zone";
import { resolveCalendarPhrase } from "@/lib/temporal/resolve";
import { deriveListSummary, type NormaliseContext } from "./normalise";
import { isDatedItem, type ExtractedItem, type TaskData } from "./schema";

/**
 * Type correction on the confirmation sheet: the §1.3 complaint was that a
 * misfiled item's only remedies were dropping it or saving it wrong. Now the
 * category itself is editable, and this module is the conversion.
 *
 * The rule that shapes everything here: the output must be a schema-valid
 * `ExtractedItem` of the target category, because /api/save re-parses it. What
 * carries over is what genuinely maps — the name of the thing, its notes, the
 * date phrase and its resolution where the target has somewhere to hold them.
 * Whatever the target requires and the source cannot supply is seeded blank
 * and named by `missingRequirementOf`, never invented.
 */

/**
 * Every category can be corrected *to* except `custom`: a custom type needs a
 * key, a name pair, an icon and a colour, and inventing those on the user's
 * behalf is exactly the guessing the proposal flow exists to avoid. Correcting
 * *from* custom works fine.
 */
export const CONVERSION_TARGETS = [
  "task",
  "event",
  "reminder",
  "alarm",
  "list",
  "note",
  "person",
  "important_date",
  "document",
  "recipe",
  "food_preference",
] as const satisfies readonly ExtractionCategory[];

export type ConversionTarget = (typeof CONVERSION_TARGETS)[number];

/** The one name-like string every category has, under five different keys. */
function titleOf(item: ExtractedItem): string {
  switch (item.category) {
    case "person":
      return item.structuredData.name;
    case "document":
      return item.structuredData.displayName;
    case "recipe":
      return item.structuredData.name;
    case "food_preference":
      return item.structuredData.foodName;
    case "note":
      return item.structuredData.title ?? item.structuredData.content.slice(0, 120).trim();
    default:
      return item.structuredData.title;
  }
}

function notesOf(item: ExtractedItem): string | null {
  switch (item.category) {
    case "list":
    case "alarm":
    case "custom":
    case "note":
      return null;
    default:
      return item.structuredData.notes;
  }
}

type DatedFields = Pick<
  TaskData,
  "datePhrase" | "resolvedDueAt" | "resolvedAllDay" | "dateAmbiguity"
>;

/**
 * A date survives a correction between dated categories, question and all —
 * "buy milk next Friday" misfiled as a note keeps nothing, but a task turned
 * reminder keeps both the phrase and the unanswered ambiguity.
 */
function datedFieldsOf(item: ExtractedItem): DatedFields {
  if (isDatedItem(item)) {
    const d = item.structuredData;
    return {
      datePhrase: d.datePhrase,
      resolvedDueAt: d.resolvedDueAt,
      resolvedAllDay: d.resolvedAllDay,
      dateAmbiguity: d.dateAmbiguity,
    };
  }
  return { datePhrase: null, resolvedDueAt: null, resolvedAllDay: true, dateAmbiguity: null };
}

/** An instant becomes the calendar day it lands in — in the user's zone, never UTC's. */
function calendarDateOf(
  dated: DatedFields,
  ctx: NormaliseContext,
): { isoDate: string | null; yearKnown: boolean } {
  if (dated.resolvedDueAt) {
    return { isoDate: isoDateInZone(new Date(dated.resolvedDueAt), ctx.timeZone), yearKnown: true };
  }
  if (dated.datePhrase) {
    const resolution = resolveCalendarPhrase(dated.datePhrase, ctx, "future");
    if (resolution.kind === "resolved") {
      return { isoDate: resolution.isoDate, yearKnown: resolution.yearKnown };
    }
  }
  return { isoDate: null, yearKnown: true };
}

/**
 * Rebuilds the item under a different category.
 *
 * `temporaryId` never changes: it is the React key, the reference other items'
 * relationships hold, and the RPC link key. The one cast at the end is the
 * same price `withDateResolution` pays — the structured data is built to match
 * the target literal, but TypeScript cannot correlate a computed pair.
 */
export function convertCategory(
  item: ExtractedItem,
  to: ConversionTarget,
  ctx: NormaliseContext,
): ExtractedItem {
  if (item.category === to) return item;

  const title = titleOf(item);
  const notes = notesOf(item);
  const dated = datedFieldsOf(item);

  const structuredData = (() => {
    switch (to) {
      case "task":
        return { title, notes, ...dated };
      case "reminder":
        return { title, relatedRef: null, relatedEntityType: null, notes, ...dated };
      case "alarm":
        return { title, ...dated };
      case "event":
        return { title, location: null, notes, ...dated };
      case "list":
        return { title, listKind: "general" as const, items: [], ...dated };
      case "note":
        // The user's own words are the best content a correction can offer.
        return { title: null, content: item.sourceText.trim() || title, noteType: "general" as const };
      case "person":
        return {
          name: title,
          relationship: null,
          birthdayPhrase: null,
          birthday: null,
          birthdayYearKnown: true,
          notes,
          generalPreferences: [],
        };
      case "important_date": {
        const date = calendarDateOf(dated, ctx);
        return {
          title,
          datePhrase: dated.datePhrase,
          eventDate: date.isoDate,
          yearKnown: date.yearKnown,
          recurrence: "none" as const,
          personRef: null,
          notes,
        };
      }
      case "document": {
        // A date on the source most plausibly meant the expiry — the reading
        // stays visible and editable on the card either way.
        const date = calendarDateOf(dated, ctx);
        return {
          documentType: "",
          displayName: title,
          documentNumber: null,
          issuePhrase: null,
          expiryPhrase: dated.datePhrase,
          issueDate: null,
          expirationDate: date.isoDate,
          issuingCountry: null,
          notes,
        };
      }
      case "recipe":
        return {
          name: title,
          description: null,
          preparationTimeMinutes: null,
          cookingTimeMinutes: null,
          servings: null,
          instructions: null,
          ingredients: [],
          notes,
        };
      case "food_preference":
        return {
          subjectRef: null,
          subjectName: null,
          foodName: title,
          preferenceType: "like" as const,
          severity: null,
          notes,
        };
    }
  })();

  const converted = { ...item, category: to, structuredData } as ExtractedItem;

  // A list's summary is derived from its rows; carrying the old sentence over
  // would leave copy that stops following the data. Other categories keep the
  // summary, matching how title edits behave.
  if (converted.category === "list") {
    return { ...converted, summary: deriveListSummary(converted.structuredData) };
  }
  return converted;
}
