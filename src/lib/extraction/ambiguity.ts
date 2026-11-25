import {
  deriveListTitle,
  isDerivedListTitle,
  storedResolution,
  type NormaliseContext,
} from "./normalise";
import {
  isDatedItem,
  withDateResolution,
  type AlarmData,
  type CustomData,
  type EventData,
  type ExtractedItem,
  type ImportantDateData,
  type ListData,
  type ReminderData,
  type TaskData,
} from "./schema";

/**
 * The user's side of the split that `src/lib/temporal` opened.
 *
 * The resolver refuses to guess between two defensible readings of a phrase
 * and returns a question instead. This module turns the answer back into a
 * date, so the guess the model used to make silently is now a decision the
 * user made explicitly.
 */

/** A question raised during normalisation, as stored on the proposal. */
export type DateAmbiguity = NonNullable<TaskData["dateAmbiguity"]>;

/**
 * What the user decided. `undated` is a real answer rather than the absence of
 * one — it is how someone says "save it, the day doesn't matter", which is not
 * the same as never having been asked.
 */
export type DateChoice =
  | { kind: "option"; iso: string; allDay: boolean }
  | { kind: "undated" };

/** Null for the categories that carry no date phrase, and when nothing was unclear. */
export function dateAmbiguityOf(item: ExtractedItem): DateAmbiguity | null {
  if (!isDatedItem(item)) return null;
  return item.structuredData.dateAmbiguity;
}

/** The instant this proposal would be saved with, if any. */
export function resolvedDueAtOf(item: ExtractedItem): string | null {
  if (!isDatedItem(item)) return null;
  return item.structuredData.resolvedDueAt;
}

/** Whether the saved date carries a clock time. False for the undated categories. */
export function resolvedAllDayOf(item: ExtractedItem): boolean {
  return isDatedItem(item) ? item.structuredData.resolvedAllDay : false;
}

/** Whitespace is the same as missing — a title of spaces helps nobody. */
function blank(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

/**
 * The one author of every required-text sentence. The card banner and the
 * field's own inline message both read from here, for the same reason the two
 * date requirements are exported below: two copies of a sentence drift the
 * first time the wording is improved in only one of them.
 */
export const TEXT_REQUIREMENTS = {
  alarmTitle: "Name the alarm, so you know what woke you.",
  reminderTitle: "Say what this reminder is about.",
  taskTitle: "Say what needs doing.",
  listTitle: "Give the list a name.",
  listRows: "Add at least one thing to the list.",
  personName: "A person needs a name.",
  importantDateTitle: "Say what this date marks.",
  documentName: "Name the document.",
  documentType: "Say what kind of document this is.",
  recipeName: "Name the recipe.",
  foodName: "Name the food this is about.",
  noteContent: "A note needs something in it.",
  customTypeName: "Name the new type.",
  eventTitle: "Say what this event is.",
} as const;

/** Field-level check the editors wire to their inputs. */
export function textRequirement(
  value: string | null | undefined,
  field: keyof typeof TEXT_REQUIREMENTS,
): string | null {
  return blank(value) ? TEXT_REQUIREMENTS[field] : null;
}

/** Every row blank covers the empty array too — a list of nothing is not a list. */
export function listRowsRequirement(data: ListData): string | null {
  return data.items.every((row) => blank(row.text)) ? TEXT_REQUIREMENTS.listRows : null;
}

/** Both halves of a custom type's name, checked as one thing. */
export function customTypeNameRequirement(data: CustomData): string | null {
  if (blank(data.singular) || blank(data.plural) || blank(data.typeKey)) {
    return TEXT_REQUIREMENTS.customTypeName;
  }
  return null;
}

/** Written in terms of the type's own name, so it cannot live in the map above. */
export function customTitleRequirement(data: CustomData): string | null {
  return blank(data.title) ? `Name this ${data.singular.toLowerCase()}.` : null;
}

/**
 * Why an alarm's date is not yet usable.
 *
 * Exported so the card's banner and the field's own message come from one
 * place. They used to be two copies of the same sentence, which is the kind of
 * pair that drifts the first time the wording is improved in only one of them.
 */
export function alarmDateRequirement(data: AlarmData): string | null {
  if (data.resolvedDueAt === null) return "Set the day and time this should ring.";
  // For an alarm, all-day means "the day is known, the time is not".
  if (data.resolvedAllDay) return "Set the time this should ring.";
  return null;
}

/** `reminders.remind_at` is `not null`: a nudge with no moment cannot be stored. */
export function reminderDateRequirement(data: ReminderData): string | null {
  return data.resolvedDueAt === null ? "Set when this reminder should arrive." : null;
}

/**
 * `important_dates.event_date` is `not null` too: a dated event with no date
 * cannot be stored. Happens when the phrase couldn't be placed ("sometime in
 * spring") — the typed date in the editor is the answer path.
 */
export function importantDateRequirement(data: ImportantDateData): string | null {
  return data.eventDate === null ? "Pick the date this falls on." : null;
}

/**
 * An event *is* a when — without one it is a note wearing a calendar icon.
 * Unlike an alarm, all-day is legal: "conference on Friday" is a real event.
 */
export function eventDateRequirement(data: EventData): string | null {
  return data.resolvedDueAt === null ? "Set when this happens." : null;
}

/**
 * Why this item cannot be saved yet, or null when it can.
 *
 * Two different kinds of blocker share this one answer. A date the app cannot
 * act on — an alarm with no clock time, a reminder with no moment — is a
 * promise the app can't keep, so it is refused rather than armed at midnight.
 * A required field the user has *cleared* in the editor is the other: it used
 * to reach the save route and come back as a 400 from Zod, which says nothing
 * about which field it meant. The sheet now names it and disables Save.
 *
 * The wording never restates the category ("A note is invalid") — it says what
 * to do next, which is the same rule the summaries follow.
 */
export function missingRequirementOf(item: ExtractedItem): string | null {
  switch (item.category) {
    case "alarm":
      return (
        textRequirement(item.structuredData.title, "alarmTitle") ??
        alarmDateRequirement(item.structuredData)
      );
    case "reminder":
      return (
        textRequirement(item.structuredData.title, "reminderTitle") ??
        reminderDateRequirement(item.structuredData)
      );
    case "task":
      return textRequirement(item.structuredData.title, "taskTitle");
    case "event":
      return (
        textRequirement(item.structuredData.title, "eventTitle") ??
        eventDateRequirement(item.structuredData)
      );
    case "list":
      return (
        textRequirement(item.structuredData.title, "listTitle") ??
        listRowsRequirement(item.structuredData)
      );
    case "person":
      return textRequirement(item.structuredData.name, "personName");
    case "important_date":
      return (
        textRequirement(item.structuredData.title, "importantDateTitle") ??
        importantDateRequirement(item.structuredData)
      );
    case "document":
      // The type matters too: `documentType` is required by the schema, and a
      // category correction seeds it blank on purpose so this names the gap.
      return (
        textRequirement(item.structuredData.displayName, "documentName") ??
        textRequirement(item.structuredData.documentType, "documentType")
      );
    case "recipe":
      return textRequirement(item.structuredData.name, "recipeName");
    case "food_preference":
      return textRequirement(item.structuredData.foodName, "foodName");
    case "note":
      return textRequirement(item.structuredData.content, "noteContent");
    case "custom":
      // The type's own name is checked first, because the item's message is
      // written in terms of it.
      return (
        customTypeNameRequirement(item.structuredData) ??
        customTitleRequirement(item.structuredData)
      );
  }
}

/**
 * Writes the answer onto the proposal.
 *
 * `dateAmbiguity` is deliberately left in place: the card keeps showing the
 * question so the answer stays visible and changeable, exactly as a matched
 * person stays reversible. What the save path reads is `resolvedDueAt`, which
 * is why the answer has to land there too.
 */
export function applyDateChoice(
  item: ExtractedItem,
  choice: DateChoice,
  ctx: NormaliseContext,
): ExtractedItem {
  if (!isDatedItem(item)) return item;

  const resolvedDueAt = choice.kind === "option" ? choice.iso : null;
  const resolvedAllDay = choice.kind === "option" ? choice.allDay : true;

  if (item.category === "list") {
    // Checked against the *old* fields: a title the user typed themselves must
    // survive the answer, so only MeOS's own wording gets rewritten.
    const retitle = isDerivedListTitle(item.structuredData, ctx);
    const data = { ...item.structuredData, resolvedDueAt, resolvedAllDay };
    return {
      ...item,
      structuredData: {
        ...data,
        // The title could only say "Shopping" while the day was unknown. Now
        // that the user has named the day, it can say which one.
        title: retitle ? deriveListTitle(data, storedResolution(data), ctx) : data.title,
      },
    };
  }

  return withDateResolution(item, {
    resolvedDueAt,
    resolvedAllDay,
    rrule: item.structuredData.rrule,
    // The question survives the answer, so the card keeps showing it and the
    // choice stays changeable.
    dateAmbiguity: item.structuredData.dateAmbiguity,
  });
}
