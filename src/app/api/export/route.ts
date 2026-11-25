import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/api";

/**
 * Export-my-data: everything the user owns, as a JSON download.
 * Runs under the caller's session, so RLS scopes it to their rows only.
 * Document numbers ARE included — it's the user's own data leaving to them.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return apiError("UNAUTHENTICATED", "Sign in to export your data", 401);
  }

  const tables = [
    "profiles",
    "people",
    "person_preferences",
    "important_dates",
    "reminders",
    "food_preferences",
    "recipes",
    "documents",
    "notes",
    "inbox_entries",
    "entity_links",
    // The v2 universal layer — every task, list, alarm, event and typed
    // record lives here. Omitting these made "everything the user owns" a
    // pre-v2 sentence (review finding).
    "items",
    "list_items",
    "item_relations",
    "item_types",
    "calendar_feeds",
    "capture_tokens",
    "push_subscriptions",
  ] as const;

  const exportPayload: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    format: "meos-export-v1",
  };

  for (const table of tables) {
    const { data, error } = await supabase.from(table).select("*");
    if (error) {
      return apiError("INTERNAL_ERROR", "Export failed. Please try again.", 500);
    }
    // Embeddings are derived machine state, not memory: 768 floats per row
    // would bloat the file and mean nothing to the person reading it. They
    // regenerate on save, so an export/import round-trip loses nothing.
    exportPayload[table] = (data ?? []).map((row) => {
      const rest = { ...(row as Record<string, unknown>) };
      delete rest.embedding;
      return rest;
    });
  }

  // recipe_ingredients has no user_id column; RLS scopes it via the recipe.
  const { data: ingredients } = await supabase.from("recipe_ingredients").select("*");
  exportPayload.recipe_ingredients = ingredients ?? [];

  return new NextResponse(JSON.stringify(exportPayload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="meos-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
