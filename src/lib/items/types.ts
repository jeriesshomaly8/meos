import { z } from "zod";

/**
 * The v2 type system.
 *
 * v1 declared its seven categories in four places — `CATEGORY_META`, a Zod
 * union, the Gemini JSON schema, and a `text[]` inside a Postgres function —
 * so adding a type meant four coordinated edits and a deploy. Here the
 * *capabilities* are closed and live only in this file, while the *types* the
 * user browses live in the `item_types` table and can grow without a release.
 */

/**
 * What the app knows how to do with an item. Closed set: each value
 * corresponds to real behaviour somewhere in the codebase, so a custom type
 * always inherits something that works rather than inventing behaviour.
 */
export const CAPABILITIES = [
  "task", // can be completed, has a due date
  "reminder", // fires at an instant
  "alarm", // rings and must be dismissed — in the DB check since 0008
  "event", // occupies a span, can sync to a calendar
  "list", // holds ordered, checkable children
  "person", // an entity other items attach to
  "document", // can expire
  "recipe", // ingredients and method
  "preference", // a like/dislike/restriction, usually about a person
  "record", // a structured fact with no special behaviour
  "note", // free text the user wanted kept as text
  "unsorted", // understood as *something*, not yet classified
] as const;

export type Capability = (typeof CAPABILITIES)[number];
export const capabilitySchema = z.enum(CAPABILITIES);

export const ITEM_STATUSES = ["active", "done", "archived", "needs_review"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export const itemStatusSchema = z.enum(ITEM_STATUSES);

export const RELATIONS = [
  "uses_list",
  "involves",
  "belongs_to",
  "refers_to",
  "part_of",
  "occurs_at",
  "for_person",
  "about",
  "ingredient_of",
  "related_to",
] as const;
export type Relation = (typeof RELATIONS)[number];
export const relationSchema = z.enum(RELATIONS);

/**
 * Approved icon and colour sets — must stay in step with
 * `meos_allowed_icons()` / `meos_allowed_colors()` in migration 0005. A
 * proposed type picks from these rather than supplying a raw value, which is
 * what keeps AI-created types looking like the rest of the app.
 */
export const TYPE_ICONS = [
  "box", "calendar", "car", "check", "clipboard", "coins", "cup-soda", "dumbbell",
  "file-text", "gift", "globe", "graduation-cap", "hammer", "heart", "home", "key",
  "landmark", "laptop", "leaf", "lightbulb", "list", "map-pin", "music", "package",
  "paw-print", "pill", "plane", "receipt", "repeat", "shield", "shopping-cart",
  "sparkles", "stethoscope", "ticket", "tv", "user", "users", "wallet", "wrench",
] as const;

export const TYPE_COLORS = [
  "person", "date", "reminder", "food", "recipe", "document", "note",
  "accent", "neutral", "success", "warning",
] as const;

export type TypeIcon = (typeof TYPE_ICONS)[number];
export type TypeColor = (typeof TYPE_COLORS)[number];

export const TYPE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export const fieldDefinitionSchema = z.object({
  key: z.string().regex(TYPE_KEY_PATTERN),
  label: z.string().min(1).max(60),
  type: z.enum(["text", "number", "date", "boolean", "select"]),
  options: z.array(z.string().min(1).max(60)).max(24).optional(),
  required: z.boolean().optional(),
});

export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;

/** A row of `item_types`, as read by the app. */
export const itemTypeSchema = z.object({
  key: z.string().regex(TYPE_KEY_PATTERN),
  singular: z.string().min(1).max(40),
  plural: z.string().min(1).max(40),
  icon: z.enum(TYPE_ICONS),
  color: z.enum(TYPE_COLORS),
  kind: z.enum(["core", "custom"]),
  defaultCapability: capabilitySchema,
  fieldSchema: z.array(fieldDefinitionSchema).max(24),
  hidden: z.boolean(),
  mergedInto: z.string().nullable(),
});

export type ItemType = z.infer<typeof itemTypeSchema>;

/** A new type the model proposed, before the user has approved it. */
export const typeProposalSchema = z.object({
  key: z.string().regex(TYPE_KEY_PATTERN),
  singular: z.string().min(1).max(40),
  plural: z.string().min(1).max(40),
  icon: z.enum(TYPE_ICONS),
  color: z.enum(TYPE_COLORS),
  defaultCapability: capabilitySchema,
  fieldSchema: z.array(fieldDefinitionSchema).max(24).default([]),
});

export type TypeProposal = z.infer<typeof typeProposalSchema>;

/** Keys seeded as core types by migration 0005. */
export const CORE_TYPE_KEYS = [
  "task", "list", "event", "reminder", "person",
  "document", "recipe", "preference", "note", "unsorted",
] as const;

/**
 * Normalises a proposed key so trivially different spellings collapse onto one
 * type: "Gift Ideas", "gift-idea" and "gift ideas" all become `gift_idea`.
 * Without this, the registry fills with near-duplicate categories, which is
 * the failure mode that makes flexible types worse than fixed ones.
 */
export function normaliseTypeKey(raw: string): string {
  const singular = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  // Naive de-pluralisation is enough for type keys and avoids a dependency.
  const depluralised = singular.endsWith("ies")
    ? `${singular.slice(0, -3)}y`
    : singular.endsWith("ses") || singular.endsWith("xes") || singular.endsWith("zes")
      ? singular.slice(0, -2)
      : singular.endsWith("s") && !singular.endsWith("ss")
        ? singular.slice(0, -1)
        : singular;
  return depluralised.slice(0, 40);
}

/**
 * Picks the existing type a proposal should reuse, or null to create it.
 * Matching on the normalised key and on singular/plural names catches the
 * common "medication" vs "medications" vs "Medicine" collisions.
 */
export function findReusableType(proposal: TypeProposal, existing: ItemType[]): ItemType | null {
  const key = normaliseTypeKey(proposal.key);
  const names = new Set(
    [proposal.singular, proposal.plural].map((n) => normaliseTypeKey(n)).filter(Boolean),
  );

  for (const type of existing) {
    if (type.mergedInto) continue;
    if (normaliseTypeKey(type.key) === key) return type;
    if (names.has(normaliseTypeKey(type.singular)) || names.has(normaliseTypeKey(type.plural))) {
      return type;
    }
  }
  return null;
}
