import { z } from "zod";
import { attributesSchema, MAX_ATTRIBUTE_KEYS } from "@/lib/items/attributes";
import { TYPE_COLORS, TYPE_ICONS } from "@/lib/items/types";

/**
 * Zod schemas for AI extraction results.
 *
 * The OpenAI response is validated against `extractionResponseSchema` before
 * anything reaches the client. The AI must never invent data: unknown values
 * are null and listed in `missingFields`, and the item is marked `uncertain`.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date (YYYY-MM-DD)");

const isoDateTime = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Expected an ISO date-time",
});

export const actionSchema = z.enum(["create", "update", "uncertain"]);

const baseItemFields = {
  temporaryId: z.string().min(1),
  action: actionSchema,
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1),
  /** temporaryIds of related items in the same extraction. */
  relationships: z.array(z.string()),
  missingFields: z.array(z.string()),
  /** The exact fragment of the user's text this item came from. */
  sourceText: z.string(),
};

export const generalPreferenceSchema = z.object({
  preferenceType: z.enum(["like", "dislike"]),
  value: z.string().min(1),
});

export const personDataSchema = z.object({
  name: z.string().min(1),
  relationship: z.string().nullable(),
  /** The user's own words for the birthday ("May 4", "4 May 1990"), verbatim. */
  birthdayPhrase: z.string().nullable(),
  /*
   * Written by `normaliseProposals()` via `resolveCalendarPhrase`, or by the
   * user typing into the editor — validated as a real date either way, same
   * reasoning as `resolvedDueAt` below.
   */
  birthday: isoDate.nullable().default(null),
  /** False when the user never said the year — stored with a sentinel year. */
  birthdayYearKnown: z.boolean().default(true),
  notes: z.string().nullable(),
  /** Non-food preferences ("loves white flowers") live on the person. */
  generalPreferences: z.array(generalPreferenceSchema),
});

export const importantDateDataSchema = z.object({
  title: z.string().min(1),
  /** The user's own words for the date, verbatim — the model never computes. */
  datePhrase: z.string().nullable(),
  /*
   * Resolved by normalisation. `event_date` is `not null` in the database, so
   * `missingRequirementOf()` blocks the save while this is empty rather than
   * letting the insert fail.
   */
  eventDate: isoDate.nullable().default(null),
  yearKnown: z.boolean().default(true),
  recurrence: z.enum(["none", "yearly"]),
  /** temporaryId of a person item in this extraction, if the date is theirs. */
  personRef: z.string().nullable(),
  notes: z.string().nullable(),
});

/**
 * A nudge at a moment. Declared *after* `dateResolutionFields` below in reading
 * order but spliced in here, because a reminder is the category the §1.3 bug
 * hurt most: the model was asked to turn "next Tuesday" into an instant, and
 * the value it invented is what the Today screen then disagreed with.
 *
 * `remind_at` is `not null` in the database, so unlike a task a reminder cannot
 * be saved without a date — `missingRequirementOf()` asks for one rather than
 * letting the insert fail.
 */
const reminderFields = {
  title: z.string().min(1),
  /** temporaryId of the item this reminder is about (e.g. a document). */
  relatedRef: z.string().nullable(),
  relatedEntityType: z
    .enum(["person", "important_date", "document", "recipe", "note", "food_preference"])
    .nullable(),
  notes: z.string().nullable(),
};

export const foodPreferenceDataSchema = z.object({
  /** temporaryId of the person this preference belongs to; null = the user. */
  subjectRef: z.string().nullable(),
  /** Name as written, used to match an existing person when subjectRef is null. */
  subjectName: z.string().nullable(),
  foodName: z.string().min(1),
  preferenceType: z.enum(["like", "dislike", "allergy", "dietary_restriction"]),
  severity: z.enum(["mild", "moderate", "severe"]).nullable(),
  notes: z.string().nullable(),
});

export const recipeIngredientSchema = z.object({
  ingredientName: z.string().min(1),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  optional: z.boolean(),
  notes: z.string().nullable(),
});

export const recipeDataSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable(),
  preparationTimeMinutes: z.number().int().min(0).nullable(),
  cookingTimeMinutes: z.number().int().min(0).nullable(),
  servings: z.number().int().min(1).nullable(),
  instructions: z.string().nullable(),
  ingredients: z.array(recipeIngredientSchema),
  notes: z.string().nullable(),
});

export const documentDataSchema = z.object({
  documentType: z.string().min(1),
  displayName: z.string().min(1),
  documentNumber: z.string().nullable(),
  /**
   * Two phrases, not one: "issued March 2019, expires 3 March" names two
   * different dates and a single field would force the model to pick.
   */
  issuePhrase: z.string().nullable(),
  expiryPhrase: z.string().nullable(),
  /** Resolved by normalisation — `past` and `future` readings respectively. */
  issueDate: isoDate.nullable().default(null),
  expirationDate: isoDate.nullable().default(null),
  issuingCountry: z.string().nullable(),
  notes: z.string().nullable(),
});

export const noteDataSchema = z.object({
  title: z.string().nullable(),
  content: z.string().min(1),
  noteType: z.enum(["idea", "memory", "general", "place", "gift_idea"]),
});

/**
 * Resolution of a date the user expressed in words.
 *
 * The model reports `datePhrase` — the fragment it saw, verbatim — and never
 * an ISO value. `src/lib/temporal` turns it into `resolvedDueAt` after
 * extraction, or fills `dateAmbiguity` and leaves the date unset. This is the
 * split that makes dates deterministic and testable without a live AI call.
 *
 * Both resolved fields default to null so the model's payload never carries
 * them; they are written by `normaliseProposals()`.
 */
const dateResolutionFields = {
  datePhrase: z.string().nullable(),
  /*
   * Written by `normaliseProposals()`, or by the confirmation UI when the user
   * answers a `dateAmbiguity`. That second path makes the client the author of
   * the value, so it is validated as a real instant here rather than trusted as
   * far as the `timestamptz` cast, where a bad string is a 500 instead of a
   * message.
   */
  resolvedDueAt: isoDateTime.nullable().default(null),
  resolvedAllDay: z.boolean().default(true),
  /**
   * Written when the phrase repeats ("every weekday at 7") — the stored rule
   * that completion advances along. Constrained to the dialect
   * `parseRrule` evaluates; a rule nothing can advance is a lie in the row.
   */
  rrule: z
    .string()
    .max(500)
    .regex(/^FREQ=/, "Expected an RRULE")
    .nullable()
    .default(null),
  dateAmbiguity: z
    .object({
      question: z.string(),
      options: z.array(z.object({ label: z.string(), iso: z.string(), allDay: z.boolean() })),
    })
    .nullable()
    .default(null),
};

export const reminderDataSchema = z.object({
  ...reminderFields,
  ...dateResolutionFields,
});

export const taskDataSchema = z.object({
  title: z.string().min(1),
  notes: z.string().nullable(),
  ...dateResolutionFields,
});

export const listItemDataSchema = z.object({
  text: z.string().min(1),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
});

export const listDataSchema = z.object({
  title: z.string().min(1),
  listKind: z.enum(["shopping", "packing", "todo", "general"]),
  /** Each entry becomes a separate checkable row, never one comma-joined blob. */
  items: z.array(listItemDataSchema),
  ...dateResolutionFields,
});

/**
 * An alarm is a reminder that *rings*: a looping tone the user has to dismiss,
 * rather than a notification they may or may not notice. It shares the date
 * fields, but `resolvedAllDay` true means "no clock time yet" — an alarm
 * without a time cannot ring, so the confirmation sheet blocks the save until
 * one is set instead of arming it silently at midnight.
 */
export const alarmDataSchema = z.object({
  title: z.string().min(1),
  ...dateResolutionFields,
});

/**
 * Something that happens — "dinner with Dana at 8", an appointment, a flight.
 * The §1.2 gap by name: an important_date is a bare calendar date and a
 * reminder is a nudge, so a timed occurrence had nowhere to live.
 *
 * `resolvedDueAt` is the *start* (stored as `items.starts_at`). v1 stores no
 * explicit end: people rarely state one, `dateResolutionFields` resolve a
 * single instant, and the ICS feed already renders a timed event as a
 * 30-minute block — inventing an end would be guessing.
 */
export const eventDataSchema = z.object({
  title: z.string().min(1),
  location: z.string().nullable(),
  notes: z.string().nullable(),
  ...dateResolutionFields,
});

/**
 * One attribute as the model reports it.
 *
 * A pair rather than a free-form object because a structured-output schema has
 * to declare its properties, and "any keys you like" cannot be declared. The
 * pairs are folded into a real object by `normaliseProposals()`, which is also
 * where they meet `attributesSchema` and the invalid ones are dropped.
 *
 * Values arrive as strings. Losing the string/number distinction costs little
 * — nothing queries these yet — and asking a model for a union type is a
 * reliable way to get neither.
 */
export const attributePairSchema = z.object({
  key: z.string().min(1).max(40),
  value: z.string().max(1000),
});

/**
 * A type the model proposed because nothing in the closed set fitted.
 *
 * This is the path that makes the registry in `src/lib/items/types.ts` mean
 * something: approving one inserts an `item_types` row, and from then on the
 * type is browsable like any other. Before this existed, "my monstera lives by
 * the window" became a note, and §1.3's complaint — that anything unrecognised
 * is *instructed* to become a note — was still half true.
 *
 * Capability is not on the proposal. A custom type is always a `record`; see
 * migration 0010 for why offering the model a choice would ship types that look
 * actionable and are not.
 */
export const customDataSchema = z.object({
  /** Raw from the model; `normaliseTypeKey()` cleans it during normalisation. */
  typeKey: z.string().min(1).max(60),
  singular: z.string().min(1).max(40),
  plural: z.string().min(1).max(40),
  icon: z.enum(TYPE_ICONS),
  color: z.enum(TYPE_COLORS),
  title: z.string().min(1),
  attributes: z.array(attributePairSchema).max(MAX_ATTRIBUTE_KEYS).default([]),
  /** Written by normalisation once the pairs have been folded and validated. */
  resolvedAttributes: attributesSchema.default({}),
  /**
   * Set when the proposal was matched onto a type that already exists, so the
   * card can say "filed under Houseplants" instead of offering to create a
   * second one. Null means this really is new.
   */
  reusedTypeKey: z.string().nullable().default(null),
  ...dateResolutionFields,
});

export const extractedItemSchema = z.discriminatedUnion("category", [
  z.object({ ...baseItemFields, category: z.literal("person"), structuredData: personDataSchema }),
  z.object({
    ...baseItemFields,
    category: z.literal("important_date"),
    structuredData: importantDateDataSchema,
  }),
  z.object({
    ...baseItemFields,
    category: z.literal("reminder"),
    structuredData: reminderDataSchema,
  }),
  z.object({
    ...baseItemFields,
    category: z.literal("food_preference"),
    structuredData: foodPreferenceDataSchema,
  }),
  z.object({ ...baseItemFields, category: z.literal("recipe"), structuredData: recipeDataSchema }),
  z.object({
    ...baseItemFields,
    category: z.literal("document"),
    structuredData: documentDataSchema,
  }),
  z.object({ ...baseItemFields, category: z.literal("note"), structuredData: noteDataSchema }),
  z.object({ ...baseItemFields, category: z.literal("task"), structuredData: taskDataSchema }),
  z.object({ ...baseItemFields, category: z.literal("list"), structuredData: listDataSchema }),
  z.object({ ...baseItemFields, category: z.literal("alarm"), structuredData: alarmDataSchema }),
  z.object({ ...baseItemFields, category: z.literal("event"), structuredData: eventDataSchema }),
  z.object({ ...baseItemFields, category: z.literal("custom"), structuredData: customDataSchema }),
]);

export const extractionResponseSchema = z.object({
  items: z.array(extractedItemSchema),
});

export type ExtractedItem = z.infer<typeof extractedItemSchema>;
export type ExtractionResponse = z.infer<typeof extractionResponseSchema>;
export type PersonData = z.infer<typeof personDataSchema>;
export type ImportantDateData = z.infer<typeof importantDateDataSchema>;
export type ReminderData = z.infer<typeof reminderDataSchema>;
export type FoodPreferenceData = z.infer<typeof foodPreferenceDataSchema>;
export type RecipeData = z.infer<typeof recipeDataSchema>;
export type DocumentData = z.infer<typeof documentDataSchema>;
export type NoteData = z.infer<typeof noteDataSchema>;
export type TaskData = z.infer<typeof taskDataSchema>;
export type ListData = z.infer<typeof listDataSchema>;
export type ListItemData = z.infer<typeof listItemDataSchema>;
export type AlarmData = z.infer<typeof alarmDataSchema>;
export type EventData = z.infer<typeof eventDataSchema>;
export type CustomData = z.infer<typeof customDataSchema>;
export type AttributePair = z.infer<typeof attributePairSchema>;

/**
 * The categories whose `datePhrase` resolves to an *instant* — a `due_at`
 * moment with an optional clock time and the `dateAmbiguity` question path.
 *
 * One declaration rather than a `category === "task" || category === "list"`
 * test repeated in normalisation, the ambiguity answer path and the card — the
 * repeated-literal habit is exactly what made v1 a four-file edit per category.
 *
 * `important_date`, `document` and a person's birthday are deliberately NOT
 * here, though they are phrase-based too: they hold *calendar dates* (Postgres
 * `date`, a `yearKnown` sentinel, no clock, no zone), resolved by
 * `resolveCalendarPhrase` in normalisation. Adding them to this list would
 * force `resolvedDueAt`/`resolvedAllDay` onto shapes that have no moment to
 * hold — the `withDateResolution` cast below would silently mistype.
 */
export const DATED_CATEGORIES = ["task", "list", "alarm", "reminder", "event", "custom"] as const;
export type DatedCategory = (typeof DATED_CATEGORIES)[number];
export type DatedItem = Extract<ExtractedItem, { category: DatedCategory }>;

export function isDatedItem(item: ExtractedItem): item is DatedItem {
  return (DATED_CATEGORIES as readonly string[]).includes(item.category);
}

/** The fields normalisation and the ambiguity answer path both write. */
export interface DateResolution {
  resolvedDueAt: string | null;
  resolvedAllDay: boolean;
  rrule: string | null;
  dateAmbiguity: TaskData["dateAmbiguity"];
}

/**
 * Writes a resolution onto a dated proposal, preserving its exact category.
 *
 * The single cast in this file is the price of a discriminated union: spreading
 * over `task | list | alarm` loses the correlation between `category` and
 * `structuredData`, even though every member carries these three fields with
 * identical types. Keeping the cast here means the call sites have none.
 */
export function withDateResolution<T extends DatedItem>(item: T, fields: DateResolution): T {
  return { ...item, structuredData: { ...item.structuredData, ...fields } } as T;
}

/**
 * Parses the raw model output. Tolerates items that fail validation by
 * dropping them (better to confirm 2 of 3 items than to fail the whole
 * analysis), but fails hard when the envelope itself is malformed.
 */
export function parseExtractionResponse(raw: unknown): {
  items: ExtractedItem[];
  droppedCount: number;
} {
  const envelope = z.object({ items: z.array(z.unknown()) }).safeParse(raw);
  if (!envelope.success) {
    throw new Error("AI response did not match the expected envelope");
  }
  const items: ExtractedItem[] = [];
  let droppedCount = 0;
  for (const candidate of envelope.data.items) {
    const parsed = extractedItemSchema.safeParse(candidate);
    if (parsed.success) {
      items.push(parsed.data);
    } else {
      droppedCount += 1;
    }
  }
  return { items, droppedCount };
}
