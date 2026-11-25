/**
 * Hand-written JSON Schema for provider structured output.
 * Must stay in sync with the Zod schemas in ./schema.ts — the Zod side is
 * the source of truth and re-validates everything the model returns.
 *
 * Kept to the subset Gemini and OpenAI both accept: every property required,
 * `additionalProperties: false`, nullability via type unions, `anyOf` for the
 * category variants. Numeric range/format constraints are enforced by Zod and
 * the prompt, not here — OpenAI strict mode rejects several of them and Gemini
 * ignores others.
 */
import { TYPE_COLORS, TYPE_ICONS } from "@/lib/items/types";

const baseItemProperties = {
  temporaryId: {
    type: "string",
    description: "Stable id for this item within the response, e.g. 'item-1'",
  },
  action: {
    type: "string",
    enum: ["create", "update", "uncertain"],
    description:
      "'update' only when this clearly refers to something the user already told MeOS about; 'uncertain' when key information is missing or ambiguous",
  },
  confidence: { type: "number", description: "0 to 1" },
  summary: { type: "string", description: "Short human-readable summary of the item" },
  relationships: {
    type: "array",
    items: { type: "string" },
    description: "temporaryIds of other items in this response that this item relates to",
  },
  missingFields: {
    type: "array",
    items: { type: "string" },
    description: "Names of fields the user did not supply and you left null",
  },
  sourceText: {
    type: "string",
    description: "The exact fragment of the user's text this item was extracted from",
  },
} as const;

function itemVariant(
  category: string,
  dataProperties: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ...baseItemProperties,
      category: { type: "string", enum: [category] },
      structuredData: {
        type: "object",
        additionalProperties: false,
        properties: dataProperties,
        required: Object.keys(dataProperties),
      },
    },
    required: [...Object.keys(baseItemProperties), "category", "structuredData"],
  };
}

const nullableString = { type: ["string", "null"] } as const;

/**
 * Deliberately asks for the user's own words, not an ISO date. The app
 * resolves the phrase itself against a known clock and timezone — the model
 * is unreliable at date arithmetic and its answers cannot be unit tested.
 */
const datePhraseProperty = {
  type: ["string", "null"],
  description:
    "The exact words the user used for when this happens ('today', 'tomorrow at 6', 'next Friday', '4 May'). Copy them verbatim. NEVER convert to a date yourself. Null if no timing was mentioned.",
} as const;
export const EXTRACTION_JSON_SCHEMA = {
  name: "meos_extraction",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        items: {
          anyOf: [
            itemVariant("person", {
              name: { type: "string" },
              relationship: nullableString,
              birthdayPhrase: {
                type: ["string", "null"],
                description:
                  "The user's exact words for the birthday ('May 4', '4 May 1990'). Copy them verbatim. NEVER convert to a date or guess a year. Null if no birthday was mentioned.",
              },
              notes: nullableString,
              generalPreferences: {
                type: "array",
                description: "Non-food likes/dislikes, e.g. 'loves white flowers'",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    preferenceType: { type: "string", enum: ["like", "dislike"] },
                    value: { type: "string" },
                  },
                  required: ["preferenceType", "value"],
                },
              },
            }),
            itemVariant("important_date", {
              title: { type: "string" },
              datePhrase: datePhraseProperty,
              recurrence: { type: "string", enum: ["none", "yearly"] },
              personRef: {
                type: ["string", "null"],
                description: "temporaryId of the person this date belongs to",
              },
              notes: nullableString,
            }),
            /*
             * The open half of the schema. Everything above names a fixed set
             * of fields; here the model names the *type* as well, and the app
             * turns an approved proposal into a row in `item_types`.
             */
            itemVariant("custom", {
              typeKey: {
                type: "string",
                description:
                  "snake_case key for the new type, singular: 'houseplant', 'vinyl_record', 'medication'",
              },
              singular: { type: "string", description: "e.g. 'Houseplant'" },
              plural: { type: "string", description: "e.g. 'Houseplants'" },
              icon: { type: "string", enum: [...TYPE_ICONS] },
              color: { type: "string", enum: [...TYPE_COLORS] },
              title: { type: "string", description: "The name of this particular thing" },
              datePhrase: datePhraseProperty,
              // Key/value pairs rather than a free-form object: a structured
              // output schema has to declare its properties, and "any keys"
              // cannot be declared.
              attributes: {
                type: "array",
                description:
                  "Facts the user stated about this thing, as snake_case key/value pairs. Never invent one.",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    key: { type: "string", description: "snake_case, e.g. 'location'" },
                    value: { type: "string" },
                  },
                  required: ["key", "value"],
                },
              },
            }),
            itemVariant("reminder", {
              title: { type: "string" },
              datePhrase: datePhraseProperty,
              relatedRef: {
                type: ["string", "null"],
                description: "temporaryId of the item this reminder is about",
              },
              relatedEntityType: {
                type: ["string", "null"],
                enum: ["person", "important_date", "document", "recipe", "note", "food_preference", null],
              },
              notes: nullableString,
            }),
            itemVariant("food_preference", {
              subjectRef: {
                type: ["string", "null"],
                description:
                  "temporaryId of the person item this preference belongs to; null when it is the user's own",
              },
              subjectName: nullableString,
              foodName: { type: "string" },
              preferenceType: {
                type: "string",
                enum: ["like", "dislike", "allergy", "dietary_restriction"],
              },
              severity: {
                type: ["string", "null"],
                enum: ["mild", "moderate", "severe", null],
              },
              notes: nullableString,
            }),
            itemVariant("recipe", {
              name: { type: "string" },
              description: nullableString,
              preparationTimeMinutes: { type: ["integer", "null"] },
              cookingTimeMinutes: { type: ["integer", "null"] },
              servings: { type: ["integer", "null"] },
              instructions: nullableString,
              ingredients: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    ingredientName: { type: "string" },
                    quantity: { type: ["number", "null"] },
                    unit: nullableString,
                    optional: { type: "boolean" },
                    notes: nullableString,
                  },
                  required: ["ingredientName", "quantity", "unit", "optional", "notes"],
                },
              },
              notes: nullableString,
            }),
            itemVariant("document", {
              documentType: {
                type: "string",
                description: "e.g. passport, id_card, driver_license, insurance, visa",
              },
              displayName: { type: "string" },
              documentNumber: nullableString,
              issuePhrase: {
                type: ["string", "null"],
                description:
                  "The user's exact words for when it was issued ('March 2019', '3 March'). Copy verbatim, never compute. Null if not mentioned.",
              },
              expiryPhrase: {
                type: ["string", "null"],
                description:
                  "The user's exact words for when it expires ('3 March', 'in six months', 'next year'). Copy verbatim, never compute. Null if not mentioned.",
              },
              issuingCountry: nullableString,
              notes: nullableString,
            }),
            itemVariant("note", {
              title: nullableString,
              content: { type: "string" },
              noteType: {
                type: "string",
                enum: ["idea", "memory", "general", "place", "gift_idea"],
              },
            }),
            itemVariant("task", {
              title: { type: "string", description: "The action to take, as an imperative" },
              notes: nullableString,
              datePhrase: datePhraseProperty,
            }),
            itemVariant("list", {
              title: {
                type: "string",
                description:
                  "What the list is, e.g. 'Shopping'. Do not add a date — the app derives that.",
              },
              listKind: {
                type: "string",
                enum: ["shopping", "packing", "todo", "general"],
              },
              items: {
                type: "array",
                description:
                  "One entry per thing on the list. 'milk, bread and eggs' is THREE entries, never one.",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    text: { type: "string" },
                    quantity: { type: ["number", "null"] },
                    unit: nullableString,
                  },
                  required: ["text", "quantity", "unit"],
                },
              },
              datePhrase: datePhraseProperty,
            }),
            itemVariant("alarm", {
              title: {
                type: "string",
                description: "What the alarm is for, e.g. 'Wake up'",
              },
              datePhrase: {
                ...datePhraseProperty,
                description:
                  "The user's own words for when it should ring, INCLUDING the time — 'tomorrow at 7am', 'at 6:30'. Copy them verbatim; never convert to a date yourself.",
              },
            }),
            itemVariant("event", {
              title: {
                type: "string",
                description: "What is happening, e.g. 'Dinner with Dana'",
              },
              location: {
                type: ["string", "null"],
                description: "Where it happens, only if the user said so",
              },
              notes: nullableString,
              datePhrase: {
                ...datePhraseProperty,
                description:
                  "The user's own words for when it happens, including any time — 'tomorrow at 8', 'Friday', 'next Tuesday at noon'. Copy them verbatim; never convert to a date yourself.",
              },
            }),
          ],
        },
      },
    },
    required: ["items"],
  },
} as const;
