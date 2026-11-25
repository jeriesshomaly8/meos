import { z } from "zod";

/**
 * Guard for `items.attributes`, the flexible JSONB column.
 *
 * These limits mirror `public.meos_attributes_ok()` in migration 0005 exactly.
 * Both exist on purpose: the database constraint is the one that cannot be
 * bypassed, and this one turns a violation into a message the confirmation UI
 * can show instead of a 500 from Postgres.
 *
 * The shape is deliberately shallow — scalars, or flat arrays of scalars. No
 * nested objects, so depth is capped at 2 and generic field metadata can
 * always render a value.
 */

export const MAX_ATTRIBUTE_KEYS = 32;
export const MAX_ATTRIBUTE_BYTES = 8192;
export const MAX_ARRAY_LENGTH = 64;
/** Lowercase snake_case, 1-40 chars — same as the SQL check. */
export const ATTRIBUTE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

const attributeScalar = z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()]);

export const attributeValueSchema = z.union([
  attributeScalar,
  z.array(attributeScalar).max(MAX_ARRAY_LENGTH),
]);

export const attributesSchema = z
  .record(z.string().regex(ATTRIBUTE_KEY_PATTERN, "Attribute keys must be snake_case"), attributeValueSchema)
  .refine((value) => Object.keys(value).length <= MAX_ATTRIBUTE_KEYS, {
    message: `An item can carry at most ${MAX_ATTRIBUTE_KEYS} attributes`,
  })
  .refine((value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_ATTRIBUTE_BYTES, {
    message: "Attributes are too large to store",
  });

export type Attributes = z.infer<typeof attributesSchema>;

/**
 * Drops anything the guard would reject instead of failing the whole item.
 *
 * Used on the extraction path: one malformed attribute out of eight should
 * cost the user that attribute, not the record. What was dropped is returned
 * so the confirmation UI can say so rather than quietly losing it.
 */
export function sanitiseAttributes(raw: unknown): { attributes: Attributes; dropped: string[] } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { attributes: {}, dropped: [] };
  }

  const attributes: Record<string, z.infer<typeof attributeValueSchema>> = {};
  const dropped: string[] = [];

  for (const [key, value] of Object.entries(raw)) {
    if (Object.keys(attributes).length >= MAX_ATTRIBUTE_KEYS) {
      dropped.push(key);
      continue;
    }
    const normalisedKey = key.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (!ATTRIBUTE_KEY_PATTERN.test(normalisedKey)) {
      dropped.push(key);
      continue;
    }
    const parsed = attributeValueSchema.safeParse(value);
    if (!parsed.success) {
      dropped.push(key);
      continue;
    }
    attributes[normalisedKey] = parsed.data;
  }

  // Trim from the end until it fits rather than rejecting outright.
  while (Buffer.byteLength(JSON.stringify(attributes), "utf8") > MAX_ATTRIBUTE_BYTES) {
    const last = Object.keys(attributes).pop();
    if (!last) break;
    delete attributes[last];
    dropped.push(last);
  }

  return { attributes, dropped };
}
