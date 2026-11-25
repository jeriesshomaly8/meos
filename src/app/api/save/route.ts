import { NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { apiError, checkRateLimit } from "@/lib/api";
import { extractedItemSchema } from "@/lib/extraction/schema";
import { buildRpcItems, type RpcItem } from "@/lib/extraction/to-rpc";
import { embeddableText, embedText, isEmbeddingConfigured } from "@/lib/ai/embeddings";

/**
 * Saves the items the user approved on the confirmation screen.
 * All inserts happen inside the save_extracted_items Postgres function —
 * one transaction, RLS enforced, user_id always from auth.uid().
 */

const savedItemSchema = z
  .object({
    item: extractedItemSchema,
    /** Set when the user confirmed this maps to an existing person. */
    existingPersonId: z.uuid().nullable(),
  })
  .strict();

const requestSchema = z
  .object({
    entryId: z.uuid().nullable(),
    items: z.array(savedItemSchema).min(1, "Nothing selected to save").max(50),
  })
  .strict();

const SAVE_LIMIT = 30;
const SAVE_WINDOW_MS = 5 * 60 * 1000;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return apiError("UNAUTHENTICATED", "Sign in to use MeOS", 401);
  }

  const rate = checkRateLimit(user.id, "save", SAVE_LIMIT, SAVE_WINDOW_MS);
  if (!rate.allowed) {
    return apiError(
      "RATE_LIMITED",
      `Too many saves — try again in ${rate.retryAfterSeconds} seconds.`,
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

  const rpcItems = buildRpcItems(parsed.data.items);

  // Stored on universal items so a due date can always be re-rendered in the
  // zone the user meant, not the zone the server happens to run in.
  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle();

  const { data, error } = await supabase.rpc("save_extracted_items", {
    payload: {
      entryId: parsed.data.entryId,
      timezone: (profile?.timezone as string | undefined) ?? "UTC",
      items: rpcItems,
    },
  });

  if (error) {
    // RPC errors carry no user text; message is safe to log.
    console.error("[save] save_extracted_items failed:", error.message);
    return apiError("INTERNAL_ERROR", "Saving failed — nothing was stored. Please try again.", 500);
  }

  const created = ((data as { created: unknown[] })?.created ?? []) as {
    temporaryId: string;
    entityType: string;
    id: string;
  }[];

  // Semantic memory is written after the RESPONSE, not before it: a
  // ten-item save was blocking the user for seconds of serial embed calls
  // (review finding). `after()` runs once the response has gone out, and a
  // failure costs nothing — a row without an embedding is still found by the
  // word-matching layer.
  if (isEmbeddingConfigured()) {
    after(() =>
      embedCreated(supabase, rpcItems, created).catch((err) =>
        console.error("[save] embedding pass failed:", err instanceof Error ? err.message : err),
      ),
    );
  }

  return NextResponse.json({ created });
}

/** Which universal-items categories land in the `items` table. */
const ITEM_CATEGORIES = new Set(["task", "list", "alarm", "event", "custom"]);

async function embedCreated(
  supabase: SupabaseClient,
  rpcItems: RpcItem[],
  created: { temporaryId: string; entityType: string; id: string }[],
) {
  const byTempId = new Map(rpcItems.map((item) => [item.temporaryId, item]));

  for (const row of created) {
    const rpcItem = byTempId.get(row.temporaryId);
    if (!rpcItem) continue;

    const isItem = ITEM_CATEGORIES.has(row.entityType);
    const isNote = row.entityType === "note";
    if (!isItem && !isNote) continue;

    const d = rpcItem.data;
    const attributes =
      d.attributes && typeof d.attributes === "object"
        ? Object.entries(d.attributes as Record<string, unknown>)
            .map(([key, value]) => `${key.replace(/_/g, " ")}: ${String(value)}`)
            .join("\n")
        : null;
    const text = embeddableText([
      d.title as string | null,
      d.name as string | null,
      d.summary as string | null,
      d.content as string | null,
      attributes,
    ]);
    if (!text) continue;

    const embedding = await embedText(text, "RETRIEVAL_DOCUMENT");
    if (!embedding) continue;

    await supabase
      .from(isItem ? "items" : "notes")
      .update({ embedding: JSON.stringify(embedding) })
      .eq("id", row.id);
  }
}
