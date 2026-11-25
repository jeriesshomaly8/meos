import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { apiError, checkRateLimit } from "@/lib/api";
import {
  AI_MODEL_UNAVAILABLE_MESSAGE,
  AI_NOT_CONFIGURED_MESSAGE,
  AiError,
  isAiConfigured,
} from "@/lib/ai";
import { extractItems } from "@/lib/extraction/extract";
import { normaliseProposals, type Ambiguity } from "@/lib/extraction/normalise";
import type { ExtractedItem } from "@/lib/extraction/schema";
import { isValidTimezone } from "@/lib/extraction/timezone";
import { itemTypeSchema, type ItemType } from "@/lib/items/types";
import { isoDateInZone } from "@/lib/temporal/zone";
import { passportNotice, type PassportRow } from "@/lib/trips/passport-check";

const requestSchema = z
  .object({
    text: z.string().trim().max(4000, "Keep it under 4000 characters").default(""),
    /** Browser timezone; falls back to the profile's stored timezone. */
    timezone: z.string().optional(),
    /**
     * A pending inbox entry being reviewed — a Siri capture opened into the
     * sheet. Analysis reuses that entry instead of minting a second one, so
     * one capture lives one lifecycle: pending → analyzed → confirmed.
     */
    entryId: z.uuid().optional(),
    /**
     * Photo capture. Client-compressed before upload; the cap is a guard, not
     * a target. Read once by the AI, never stored.
     */
    image: z
      .object({
        mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
        dataBase64: z.string().min(1).max(1_500_000, "That photo is too large"),
      })
      .optional(),
  })
  .strict()
  .refine((value) => value.text.length > 0 || value.image, {
    message: "Write something first",
    path: ["text"],
  });

/** A person match found in the user's existing data, keyed by temporaryId. */
export interface PersonMatch {
  personId: string;
  personName: string;
}

const ANALYZE_LIMIT = 10;
const ANALYZE_WINDOW_MS = 5 * 60 * 1000;
const MAX_PEOPLE_TO_MATCH = 500;
/** Core types plus whatever the user has approved; nobody has hundreds. */
const MAX_TYPES_TO_MATCH = 200;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return apiError("UNAUTHENTICATED", "Sign in to use MeOS", 401);
  }

  if (!isAiConfigured()) {
    return apiError("NOT_CONFIGURED", AI_NOT_CONFIGURED_MESSAGE, 503);
  }

  const rate = checkRateLimit(user.id, "analyze", ANALYZE_LIMIT, ANALYZE_WINDOW_MS);
  if (!rate.allowed) {
    return apiError(
      "RATE_LIMITED",
      `You're going fast — try again in ${rate.retryAfterSeconds} seconds.`,
      429,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_INPUT", "Request body must be JSON", 400);
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid input";
    return apiError("INVALID_INPUT", message, 400);
  }

  const [{ data: profile }, { data: typeRows }] = await Promise.all([
    supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
    /*
     * The user's own types plus the global core ones — RLS returns both. A
     * proposal is matched against these before anything is created, so
     * "medications" lands on the "medication" the user already approved rather
     * than beside it. Without this the registry fills with near-duplicates and
     * flexible types are worse than fixed ones (§5).
     */
    supabase
      .from("item_types")
      .select("key, singular, plural, icon, color, kind, default_capability, field_schema, hidden, merged_into")
      .limit(MAX_TYPES_TO_MATCH),
  ]);

  const existingTypes: ItemType[] = ((typeRows ?? []) as Record<string, unknown>[]).flatMap(
    (row) => {
      const parsedType = itemTypeSchema.safeParse({
        key: row.key,
        singular: row.singular,
        plural: row.plural,
        icon: row.icon,
        color: row.color,
        kind: row.kind,
        defaultCapability: row.default_capability,
        fieldSchema: row.field_schema ?? [],
        hidden: row.hidden ?? false,
        mergedInto: row.merged_into ?? null,
      });
      // A row the app can't read is a row it shouldn't match against; skipping
      // it costs a possible reuse, where trusting it would mean a bad key.
      return parsedType.success ? [parsedType.data] : [];
    },
  );

  const timezone =
    parsed.data.timezone && isValidTimezone(parsed.data.timezone)
      ? parsed.data.timezone
      : ((profile?.timezone as string | undefined) ?? "UTC");

  // Record the submission before analysis so nothing the user wrote is lost
  // even if the AI call fails. A capture arriving from the inbox reuses its
  // own entry — RLS scopes the update, and a miss (someone else's id, or a
  // deleted entry) falls through to a fresh insert rather than failing.
  // The audit trail records the typed words; a photo-only capture records
  // that a photo was read (the image itself is never stored).
  const originalText = parsed.data.text || "📷 Photo capture";

  let entry: { id: string } | null = null;
  if (parsed.data.entryId) {
    const { data: reused } = await supabase
      .from("inbox_entries")
      .update({ original_text: originalText, processing_status: "pending" })
      .eq("id", parsed.data.entryId)
      .select("id")
      .maybeSingle();
    entry = (reused as { id: string } | null) ?? null;
  }
  if (!entry) {
    const { data: created, error: entryError } = await supabase
      .from("inbox_entries")
      .insert({ user_id: user.id, original_text: originalText, processing_status: "pending" })
      .select("id")
      .single();
    if (entryError || !created) {
      return apiError("INTERNAL_ERROR", "Could not record your entry. Please try again.", 500);
    }
    entry = created as { id: string };
  }

  let items: ExtractedItem[];
  let droppedCount: number;
  let ambiguities: Ambiguity[] = [];
  try {
    const extracted = await extractItems(
      parsed.data.text,
      timezone,
      new Date(),
      parsed.data.image,
    );
    droppedCount = extracted.droppedCount;
    // Dates are resolved here, in code, against a known clock and zone — the
    // model only ever reported the phrase it saw.
    ({ items, ambiguities } = normaliseProposals(extracted.items, {
      now: new Date(),
      timeZone: timezone,
      existingTypes,
    }));
  } catch (error) {
    await supabase
      .from("inbox_entries")
      .update({ processing_status: "failed" })
      .eq("id", entry.id);
    if (error instanceof AiError) {
      switch (error.code) {
        case "QUOTA_EXCEEDED":
          return apiError(
            "RATE_LIMITED",
            "You've hit today's free AI quota. It resets daily — your text was saved, so you can analyze it again later.",
            429,
          );
        case "NOT_CONFIGURED":
          return apiError("NOT_CONFIGURED", AI_NOT_CONFIGURED_MESSAGE, 503);
        case "MODEL_UNAVAILABLE":
          return apiError("NOT_CONFIGURED", AI_MODEL_UNAVAILABLE_MESSAGE, 503);
        case "BAD_RESPONSE":
          return apiError(
            "PROVIDER_ERROR",
            "The AI couldn't make sense of that. Try rephrasing.",
            502,
          );
        default:
          return apiError(
            "PROVIDER_ERROR",
            "The AI service is unavailable right now. Your text was saved — try analyzing again in a moment.",
            502,
          );
      }
    }
    return apiError("INTERNAL_ERROR", "Something went wrong analyzing your text.", 500);
  }

  // Match extracted people against people the user already saved, so the
  // confirmation screen can offer "update existing" instead of a duplicate.
  const matches: Record<string, PersonMatch> = {};
  const namesToMatch = new Map<string, string[]>(); // lowercased name -> temporaryIds
  for (const item of items) {
    const name =
      item.category === "person"
        ? item.structuredData.name
        : item.category === "food_preference" && !item.structuredData.subjectRef
          ? item.structuredData.subjectName
          : null;
    if (name) {
      const key = name.trim().toLowerCase();
      namesToMatch.set(key, [...(namesToMatch.get(key) ?? []), item.temporaryId]);
    }
  }
  if (namesToMatch.size > 0) {
    // Case-insensitive matching happens in JS: Postgres `in` is case-sensitive
    // and an ilike-per-name would be N queries. Personal address books are
    // small, so one bounded fetch is cheaper than either.
    const { data: existingPeople } = await supabase
      .from("people")
      .select("id, name")
      .limit(MAX_PEOPLE_TO_MATCH);
    for (const person of existingPeople ?? []) {
      const tempIds = namesToMatch.get((person.name as string).trim().toLowerCase());
      for (const tempId of tempIds ?? []) {
        matches[tempId] = { personId: person.id as string, personName: person.name as string };
      }
    }
  }

  /*
   * Trip brain: a trip proposal is the one moment a passport check is worth
   * interrupting for — rebooking is cheap now and a ruined morning later.
   * The trip's end (resolved `until`, falling back to its start) is held
   * against the soonest-expiring passport; the sentence rides the response
   * as a notice, informative and never blocking.
   */
  const notices: string[] = [];
  const tripEnds = items.flatMap((item) => {
    if (item.category !== "custom" || item.structuredData.typeKey !== "trip") return [];
    const until = item.structuredData.resolvedAttributes.until;
    if (typeof until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(until)) return [until];
    const start = item.structuredData.resolvedDueAt;
    return start ? [isoDateInZone(new Date(start), timezone)] : [];
  });
  if (tripEnds.length > 0) {
    const { data: passports } = await supabase
      .from("documents")
      .select("display_name, expiration_date")
      .ilike("document_type", "%passport%")
      .not("expiration_date", "is", null)
      // An expired passport is history, not a warning: without this, the old
      // renewed passport out-soonests the valid one and cries wolf (review).
      .gte("expiration_date", isoDateInZone(new Date(), timezone))
      .limit(10);
    for (const tripEnd of tripEnds) {
      const notice = passportNotice(tripEnd, (passports ?? []) as PassportRow[]);
      if (notice && !notices.includes(notice)) notices.push(notice);
    }
  }

  await supabase
    .from("inbox_entries")
    .update({ processing_status: "analyzed", extracted_json: { items } })
    .eq("id", entry.id);

  return NextResponse.json({ entryId: entry.id, items, matches, droppedCount, ambiguities, notices });
}
