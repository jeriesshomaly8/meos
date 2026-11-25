import { isoDateInZone, partsInZone } from "@/lib/temporal/zone";
import {
  biasInstantPast,
  resolveCalendarPhrase,
  resolveDatePhrase,
  resolveRecurringPhrase,
  type CalendarDirection,
  type Resolution,
} from "@/lib/temporal/resolve";
import {
  ATTRIBUTE_KEY_PATTERN,
  attributesSchema,
  MAX_ATTRIBUTE_KEYS,
  type Attributes,
} from "@/lib/items/attributes";
import { findReusableType, normaliseTypeKey, type ItemType } from "@/lib/items/types";
import {
  isDatedItem,
  withDateResolution,
  type AlarmData,
  type AttributePair,
  type CustomData,
  type EventData,
  type ExtractedItem,
  type ListData,
  type ReminderData,
  type TaskData,
} from "./schema";

/**
 * Deterministic pass over the model's output.
 *
 * Everything here is logic the LLM used to be asked to do and got wrong:
 * resolving relative dates, deciding when a date is genuinely ambiguous, and
 * writing titles. It runs against an explicit clock and timezone, so the same
 * input always produces the same output and the tests need no API call.
 */

export interface NormaliseContext {
  now: Date;
  timeZone: string;
  /**
   * Types the user already has, so a proposal can be matched onto one instead
   * of creating a near-duplicate. Optional because most callers — every test
   * that isn't about custom types — have no reason to care.
   */
  existingTypes?: ItemType[];
}

/** A question the user must answer before the item can be saved with a date. */
export interface Ambiguity {
  temporaryId: string;
  question: string;
  options: { label: string; iso: string; allDay: boolean }[];
}

type DatedData = TaskData | ListData | AlarmData | ReminderData | EventData | CustomData;

/**
 * One wording per list kind, used both in derived titles and in the kind
 * dropdown. Declared once on purpose — the same metadata living in four places
 * is what made adding a category a four-file edit in v1.
 */
export const LIST_KIND_LABEL: Record<ListData["listKind"], string> = {
  shopping: "Shopping",
  packing: "Packing",
  todo: "To do",
  general: "List",
};

/**
 * Titles a list from what it *is* rather than asking the model for a phrase.
 * "Shopping for today" is derivable from listKind + the resolved date, so
 * deriving it is both cheaper and impossible to get wrong.
 */
export function deriveListTitle(
  data: ListData,
  resolution: Resolution | null,
  ctx: NormaliseContext,
): string {
  const kind = LIST_KIND_LABEL[data.listKind];
  if (!resolution || resolution.kind !== "resolved") return kind;

  const todayIso = isoDateInZone(ctx.now, ctx.timeZone);
  const targetIso = isoDateInZone(resolution.instant, ctx.timeZone);
  if (targetIso === todayIso) return `${kind} for today`;

  const tomorrow = new Date(ctx.now.getTime() + 86_400_000);
  if (targetIso === isoDateInZone(tomorrow, ctx.timeZone)) return `${kind} for tomorrow`;

  const p = partsInZone(resolution.instant, ctx.timeZone);
  const label = new Intl.DateTimeFormat("en-GB", {
    timeZone: ctx.timeZone,
    day: "numeric",
    month: "short",
    ...(p.year === partsInZone(ctx.now, ctx.timeZone).year ? {} : { year: "numeric" }),
  }).format(resolution.instant);
  return `${kind} for ${label}`;
}

/**
 * Summarises a list by its contents. The v1 habit of restating the category
 * ("A list") told the user nothing they couldn't see from the icon.
 */
export function deriveListSummary(data: ListData): string {
  const names = data.items.map((i) => i.text.trim()).filter(Boolean);
  if (names.length === 0) return "Empty list";
  const shown = names.slice(0, 3).join(", ");
  const rest = names.length - 3;
  return rest > 0 ? `${names.length} items — ${shown} and ${rest} more` : shown;
}

/**
 * Folds the model's key/value pairs into the object the database stores.
 *
 * Invalid entries are dropped rather than failing the whole proposal: one
 * attribute the model spelled with a capital letter should not cost the user
 * the item it was attached to. What survives is guaranteed to satisfy
 * `attributesSchema`, which mirrors the Postgres check exactly — so anything
 * that gets past here cannot be rejected later by the constraint.
 */
export function foldAttributes(pairs: AttributePair[]): Attributes {
  const folded: Record<string, string> = {};

  for (const pair of pairs) {
    const key = pair.key.trim().toLowerCase().replace(/[\s-]+/g, "_");
    const value = pair.value.trim();
    if (!value) continue;
    if (!ATTRIBUTE_KEY_PATTERN.test(key)) continue;
    // First wins: a repeated key is the model restating itself, and the later
    // mention is no more trustworthy than the earlier one.
    if (key in folded) continue;
    if (Object.keys(folded).length >= MAX_ATTRIBUTE_KEYS) break;
    folded[key] = value.slice(0, 1000);
  }

  const parsed = attributesSchema.safeParse(folded);
  return parsed.success ? parsed.data : {};
}

/** Rebuilds the resolution a proposal's stored fields imply, for re-deriving copy. */
export function storedResolution(data: DatedData): Resolution | null {
  if (!data.resolvedDueAt) return null;
  return {
    kind: "resolved",
    instant: new Date(data.resolvedDueAt),
    allDay: data.resolvedAllDay,
    phrase: data.datePhrase ?? "",
  };
}

/**
 * Whether the copy on a list is still MeOS's own wording.
 *
 * Derived titles and summaries have to follow the data — a list retitled
 * "Shopping for 14 Aug" is wrong the moment the day changes. But the user is
 * allowed to overrule them, and their wording must then survive every later
 * edit. Comparing against what would be derived answers "did they touch it?"
 * without storing a flag that could drift out of sync.
 */
export function isDerivedListTitle(data: ListData, ctx: NormaliseContext): boolean {
  return data.title === deriveListTitle(data, storedResolution(data), ctx);
}

export function isDerivedListSummary(summary: string, data: ListData): boolean {
  return summary === deriveListSummary(data);
}

/**
 * Resolves every date phrase and rewrites derived copy.
 *
 * Returns the items with `resolvedDueAt` / `dateAmbiguity` filled in, plus a
 * flat list of the questions the confirmation UI must ask. An unresolvable
 * phrase leaves the date unset rather than guessing — the item is still worth
 * saving without one.
 */
export function normaliseProposals(
  items: ExtractedItem[],
  ctx: NormaliseContext,
): { items: ExtractedItem[]; ambiguities: Ambiguity[] } {
  const ambiguities: Ambiguity[] = [];

  const normalised = items.map((item): ExtractedItem => {
    if (!isDatedItem(item)) return resolveCalendarDates(item, ctx);

    const data = item.structuredData as DatedData;
    const phrase = data.datePhrase?.trim();

    /*
     * Repeats are checked first: "every Friday" read by the one-off resolver
     * is the soonest Friday — right day, wrong meaning. A recurring phrase
     * yields the rule plus its first firing, and is never ambiguous.
     */
    const recurring = phrase ? resolveRecurringPhrase(phrase, ctx) : null;
    const resolution = phrase && !recurring ? resolveDatePhrase(phrase, ctx) : null;

    let resolvedDueAt: string | null = null;
    let resolvedAllDay = true;
    const rrule = recurring?.rrule ?? null;
    let dateAmbiguity: DatedData["dateAmbiguity"] = null;

    if (recurring) {
      resolvedDueAt = recurring.firstInstant.toISOString();
      resolvedAllDay = recurring.allDay;
    } else if (resolution?.kind === "resolved") {
      resolvedDueAt = resolution.instant.toISOString();
      resolvedAllDay = resolution.allDay;
    } else if (resolution?.kind === "ambiguous") {
      dateAmbiguity = {
        question: resolution.question,
        options: resolution.options.map((o) => ({
          label: o.label,
          iso: o.instant.toISOString(),
          allDay: o.allDay,
        })),
      };
      ambiguities.push({
        temporaryId: item.temporaryId,
        question: resolution.question,
        options: dateAmbiguity.options,
      });
    }

    if (item.category === "custom") {
      const data = item.structuredData;
      const typeKey = normaliseTypeKey(data.typeKey) || normaliseTypeKey(data.singular);
      /*
       * Matched against what the user already has before anything is created.
       * This is the §5 mitigation: without it the registry fills with
       * "medication" / "medications" / "Medicine" and flexible types become
       * worse than fixed ones.
       */
      const reused = findReusableType(
        { ...data, key: typeKey, defaultCapability: "record", fieldSchema: [] },
        ctx.existingTypes ?? [],
      );
      const resolvedAttributes = foldAttributes(data.attributes);

      /*
       * A trip's `until` arrives as the user's words ("10 October") and
       * leaves as a date, resolved the same deterministic way as everything
       * else — it is what the passport cross-check reads. Unresolvable words
       * stay as words: still true, just not checkable.
       */
      const effectiveKey = reused?.key ?? typeKey;
      if (effectiveKey === "trip" && typeof resolvedAttributes.until === "string") {
        const until = resolveCalendarPhrase(resolvedAttributes.until, ctx, "future");
        if (until.kind === "resolved") resolvedAttributes.until = until.isoDate;
      }

      /*
       * Health facts record what HAPPENED: "a tetanus shot on 3 March" is
       * last March. The generic resolver rolls year-less dates forward — the
       * right reading for a due date, the wrong one here.
       */
      let customDueAt = resolvedDueAt;
      if (
        (effectiveKey === "vaccination" || effectiveKey === "health_note") &&
        resolution?.kind === "resolved"
      ) {
        customDueAt = biasInstantPast(resolution.instant, phrase ?? "", ctx).toISOString();
      }

      return {
        ...item,
        structuredData: {
          ...data,
          typeKey: effectiveKey,
          reusedTypeKey: reused?.key ?? null,
          resolvedAttributes,
          resolvedDueAt: customDueAt,
          resolvedAllDay,
          dateAmbiguity,
        },
      };
    }

    if (item.category === "list") {
      const listData = item.structuredData;
      return {
        ...item,
        summary: deriveListSummary(listData),
        structuredData: {
          ...listData,
          title: deriveListTitle(listData, resolution, ctx),
          resolvedDueAt,
          resolvedAllDay,
          dateAmbiguity,
        },
      };
    }

    /*
     * Tasks, alarms and reminders. For an alarm, `resolvedAllDay` true carries
     * a second meaning: "wake me tomorrow" resolves to tomorrow 00:00, which is
     * the right day and the wrong time, so the sheet asks for one rather than
     * arming a midnight alarm nobody wanted.
     *
     * The rule is only kept where completion can actually honour it — task
     * and alarm. A reminder row has no rrule column, so keeping the rule
     * there made the card promise repetition the save then dropped (review
     * finding); a recurring phrase still resolves its first firing.
     */
    const persistedRrule =
      item.category === "task" || item.category === "alarm" ? rrule : null;
    return withDateResolution(item, {
      resolvedDueAt,
      resolvedAllDay,
      rrule: persistedRrule,
      dateAmbiguity,
    });
  });

  return { items: dedupeProposals(normalised), ambiguities };
}

/**
 * The calendar-date half of resolution — the same phrase-in, value-out move
 * the dated categories made, for the three that hold Postgres `date` columns
 * instead of instants. The model reports what it heard; the direction each
 * field resolves under is a property of what the field *means*, decided here
 * and not by the model.
 */
function resolveCalendarDates(item: ExtractedItem, ctx: NormaliseContext): ExtractedItem {
  const resolve = (phrase: string | null, direction: CalendarDirection) => {
    const trimmed = phrase?.trim();
    if (!trimmed) return null;
    const resolution = resolveCalendarPhrase(trimmed, ctx, direction);
    return resolution.kind === "resolved" ? resolution : null;
  };

  if (item.category === "person") {
    const data = item.structuredData;
    const birthday = resolve(data.birthdayPhrase, "memory");
    if (!birthday) return item;
    return {
      ...item,
      structuredData: {
        ...data,
        birthday: birthday.isoDate,
        birthdayYearKnown: birthday.yearKnown,
      },
    };
  }

  if (item.category === "important_date") {
    const data = item.structuredData;
    /*
     * A yearly date ("our anniversary is June 12") is a memory — the original
     * year is unknown and stays behind the sentinel. A one-off ("the wedding
     * is on 4 May") is an upcoming event, so a year-less date means its next
     * occurrence.
     */
    const eventDate = resolve(data.datePhrase, data.recurrence === "yearly" ? "memory" : "future");
    if (!eventDate) return item;
    return {
      ...item,
      structuredData: {
        ...data,
        eventDate: eventDate.isoDate,
        yearKnown: eventDate.yearKnown,
      },
    };
  }

  if (item.category === "document") {
    const data = item.structuredData;
    // An expiry is a future fact, an issue date a past one.
    const expiration = resolve(data.expiryPhrase, "future");
    const issue = resolve(data.issuePhrase, "past");
    if (!expiration && !issue) return item;
    return {
      ...item,
      structuredData: {
        ...data,
        expirationDate: expiration?.isoDate ?? data.expirationDate,
        issueDate: issue?.isoDate ?? data.issueDate,
      },
    };
  }

  return item;
}

/**
 * Collapses proposals the model emitted twice.
 *
 * One sentence mentioning "Dana" three times should not produce three Dana
 * records. Matching is on category plus a normalised identity string, so it is
 * conservative: near-misses stay separate and the user can merge them.
 */
export function dedupeProposals(items: ExtractedItem[]): ExtractedItem[] {
  const seen = new Map<string, ExtractedItem>();
  const order: string[] = [];

  for (const item of items) {
    const key = `${item.category}:${identityOf(item)}`;
    if (!seen.has(key)) {
      seen.set(key, item);
      order.push(key);
      continue;
    }
    // Keep whichever the model was more confident about.
    const existing = seen.get(key)!;
    if (item.confidence > existing.confidence) seen.set(key, item);
  }

  return order.map((key) => seen.get(key)!);
}

function identityOf(item: ExtractedItem): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  switch (item.category) {
    case "person":
      return norm(item.structuredData.name);
    case "food_preference":
      return `${norm(item.structuredData.subjectName ?? "")}|${norm(item.structuredData.foodName)}`;
    case "important_date":
      return `${norm(item.structuredData.title)}|${item.structuredData.eventDate}`;
    case "document":
      return norm(item.structuredData.displayName);
    case "recipe":
      return norm(item.structuredData.name);
    case "task":
      // The moment is part of the identity: "take amoxicillin" every morning
      // and every evening are two tasks, while two undated "buy milk" are
      // still one.
      return `${norm(item.structuredData.title)}|${item.structuredData.resolvedDueAt ?? ""}`;
    case "alarm":
      // Two alarms with the same wording but different times are two alarms.
      return `${norm(item.structuredData.title)}|${item.structuredData.resolvedDueAt ?? ""}`;
    case "event":
      // Same reasoning: dinner at 8 and dinner at 9 are two dinners.
      return `${norm(item.structuredData.title)}|${item.structuredData.resolvedDueAt ?? ""}`;
    case "list":
      return `${item.structuredData.listKind}|${norm(item.structuredData.title)}`;
    case "reminder":
      // Same reasoning as an alarm: one wording at two moments is two nudges.
      return `${norm(item.structuredData.title)}|${item.structuredData.resolvedDueAt ?? ""}`;
    case "note":
      return norm(item.structuredData.content).slice(0, 120);
    case "custom":
      // Two monsteras under one type are two plants; the type key alone would
      // collapse every houseplant the user mentioned into one row. The moment
      // joins the identity so two trips to Rome stay two trips.
      return `${item.structuredData.typeKey}|${norm(item.structuredData.title)}|${item.structuredData.resolvedDueAt ?? ""}`;
  }
}
