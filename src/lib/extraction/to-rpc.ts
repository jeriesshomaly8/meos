import type { ExtractedItem } from "./schema";

/**
 * Maps user-approved extraction items to the payload consumed by the
 * save_extracted_items Postgres function (see supabase/migrations).
 * Pure and synchronous, so the analyze → confirm → save pipeline is testable
 * without a database.
 */

export interface ApprovedItem {
  item: ExtractedItem;
  /** Set when the user confirmed this maps to an existing person. */
  existingPersonId: string | null;
}

export interface RpcItem {
  temporaryId: string;
  category: string;
  action: "create" | "update";
  existingId: string | null;
  personRef: string | null;
  data: Record<string, unknown>;
  links: { targetRef: string; targetType: string; relationshipType: string }[];
}

export function buildRpcItems(saved: ApprovedItem[]): RpcItem[] {
  const rpcItems: RpcItem[] = [];
  const categoryByTempId = new Map<string, string>();
  for (const { item } of saved) {
    categoryByTempId.set(item.temporaryId, item.category);
  }
  // People synthesized from food preferences whose subject isn't in the batch.
  const syntheticPeople = new Map<string, string>(); // lowercased name -> tempId
  let syntheticCounter = 0;

  for (const { item, existingPersonId } of saved) {
    const base = {
      temporaryId: item.temporaryId,
      existingId: null as string | null,
      personRef: null as string | null,
      links: [] as RpcItem["links"],
    };

    switch (item.category) {
      case "person": {
        const d = item.structuredData;
        rpcItems.push({
          ...base,
          category: "person",
          action: existingPersonId ? "update" : "create",
          existingId: existingPersonId,
          data: {
            name: d.name,
            relationship: d.relationship,
            birthday: d.birthday,
            birthday_year_known: d.birthdayYearKnown,
            notes: d.notes,
          },
        });
        d.generalPreferences.forEach((pref, index) => {
          rpcItems.push({
            temporaryId: `${item.temporaryId}-general-pref-${index}`,
            category: "person_preference",
            action: "create",
            existingId: null,
            personRef: item.temporaryId,
            data: { preference_type: pref.preferenceType, value: pref.value, notes: null },
            links: [],
          });
        });
        break;
      }
      case "important_date": {
        const d = item.structuredData;
        rpcItems.push({
          ...base,
          category: "important_date",
          action: "create",
          personRef: d.personRef,
          data: {
            title: d.title,
            event_date: d.eventDate,
            year_known: d.yearKnown,
            recurrence: d.recurrence,
            notes: d.notes,
          },
        });
        break;
      }
      case "reminder": {
        const d = item.structuredData;
        rpcItems.push({
          ...base,
          category: "reminder",
          action: "create",
          data: {
            title: d.title,
            // Resolved from the phrase by `normaliseProposals()`, never by the
            // model. `remind_at` is `not null`, and the confirmation sheet will
            // not let a dateless reminder through — same gate as an alarm.
            remind_at: d.resolvedDueAt,
            related_ref: d.relatedRef,
            related_entity_type: d.relatedEntityType,
          },
        });
        break;
      }
      case "food_preference": {
        const d = item.structuredData;
        let personRef = d.subjectRef ?? existingPersonId;
        // The preference names a person who isn't in this batch and doesn't
        // exist yet — create a minimal person record for them. Their name was
        // stated by the user, so this is not invented data.
        if (!personRef && d.subjectName) {
          const key = d.subjectName.trim().toLowerCase();
          if (!syntheticPeople.has(key)) {
            const tempId = `auto-person-${syntheticCounter++}`;
            syntheticPeople.set(key, tempId);
            rpcItems.push({
              temporaryId: tempId,
              category: "person",
              action: "create",
              existingId: null,
              personRef: null,
              data: {
                name: d.subjectName.trim(),
                relationship: null,
                birthday: null,
                birthday_year_known: true,
                notes: null,
              },
              links: [],
            });
          }
          personRef = syntheticPeople.get(key)!;
        }
        rpcItems.push({
          ...base,
          category: "food_preference",
          action: "create",
          personRef,
          data: {
            food_name: d.foodName,
            preference_type: d.preferenceType,
            severity: d.severity,
            notes: d.notes,
          },
        });
        break;
      }
      case "recipe": {
        const d = item.structuredData;
        rpcItems.push({
          ...base,
          category: "recipe",
          action: "create",
          data: {
            name: d.name,
            description: d.description,
            preparation_time_minutes: d.preparationTimeMinutes,
            cooking_time_minutes: d.cookingTimeMinutes,
            servings: d.servings,
            instructions: d.instructions,
            notes: d.notes,
            ingredients: d.ingredients.map((ing) => ({
              ingredient_name: ing.ingredientName,
              quantity: ing.quantity,
              unit: ing.unit,
              optional: ing.optional,
              notes: ing.notes,
            })),
          },
        });
        break;
      }
      case "document": {
        const d = item.structuredData;
        rpcItems.push({
          ...base,
          category: "document",
          action: "create",
          data: {
            document_type: d.documentType,
            display_name: d.displayName,
            document_number: d.documentNumber,
            issue_date: d.issueDate,
            expiration_date: d.expirationDate,
            issuing_country: d.issuingCountry,
            notes: d.notes,
          },
        });
        break;
      }
      case "note": {
        const d = item.structuredData;
        rpcItems.push({
          ...base,
          category: "note",
          action: "create",
          data: { title: d.title, content: d.content, note_type: d.noteType },
        });
        break;
      }
      case "task": {
        const d = item.structuredData;
        rpcItems.push({
          ...base,
          category: "task",
          action: "create",
          data: {
            title: d.title,
            summary: d.notes,
            // Already resolved by normaliseProposals(); the raw phrase is kept
            // so the UI can show what the date came from.
            due_at: d.resolvedDueAt,
            all_day: d.resolvedAllDay,
            rrule: d.rrule,
            date_phrase: d.datePhrase,
            source_text: item.sourceText,
            confidence: item.confidence,
          },
        });
        break;
      }
      case "custom": {
        const d = item.structuredData;
        rpcItems.push({
          ...base,
          category: "custom",
          action: "create",
          data: {
            type_key: d.typeKey,
            singular: d.singular,
            plural: d.plural,
            icon: d.icon,
            color: d.color,
            title: d.title,
            summary: item.summary,
            // Already folded and validated against the same limits the
            // Postgres check enforces, so the constraint can only agree.
            attributes: d.resolvedAttributes,
            due_at: d.resolvedDueAt,
            all_day: d.resolvedAllDay,
            source_text: item.sourceText,
            confidence: item.confidence,
          },
        });
        break;
      }
      case "alarm": {
        const d = item.structuredData;
        rpcItems.push({
          ...base,
          category: "alarm",
          action: "create",
          data: {
            title: d.title,
            due_at: d.resolvedDueAt,
            rrule: d.rrule,
            date_phrase: d.datePhrase,
            source_text: item.sourceText,
            confidence: item.confidence,
          },
        });
        break;
      }
      case "event": {
        const d = item.structuredData;
        rpcItems.push({
          ...base,
          category: "event",
          action: "create",
          data: {
            title: d.title,
            summary: d.notes,
            // An event's resolved instant is its *start* — `items.starts_at`,
            // not `due_at`; an event is attended, not completed.
            starts_at: d.resolvedDueAt,
            all_day: d.resolvedAllDay,
            date_phrase: d.datePhrase,
            location: d.location,
            source_text: item.sourceText,
            confidence: item.confidence,
          },
        });
        break;
      }
      case "list": {
        const d = item.structuredData;
        rpcItems.push({
          ...base,
          category: "list",
          action: "create",
          data: {
            title: d.title,
            summary: item.summary,
            list_kind: d.listKind,
            due_at: d.resolvedDueAt,
            all_day: d.resolvedAllDay,
            date_phrase: d.datePhrase,
            source_text: item.sourceText,
            confidence: item.confidence,
            list_items: d.items.map((entry) => ({
              text: entry.text,
              quantity: entry.quantity,
              unit: entry.unit,
            })),
          },
        });
        break;
      }
    }
  }

  // Explicit relationship links, skipping the ones already captured by
  // personRef/relatedRef foreign keys.
  for (const { item } of saved) {
    const rpcItem = rpcItems.find((r) => r.temporaryId === item.temporaryId);
    if (!rpcItem) continue;
    const alreadyLinked = new Set(
      [
        rpcItem.personRef,
        item.category === "reminder" ? item.structuredData.relatedRef : null,
      ].filter(Boolean) as string[],
    );
    for (const targetRef of item.relationships) {
      if (alreadyLinked.has(targetRef) || targetRef === item.temporaryId) continue;
      const targetCategory = categoryByTempId.get(targetRef);
      if (!targetCategory) continue; // target was excluded by the user
      rpcItem.links.push({
        targetRef,
        targetType: targetCategory,
        relationshipType: "related_to",
      });
    }
  }

  return rpcItems;
}
