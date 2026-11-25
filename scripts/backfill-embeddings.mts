/**
 * One-time semantic backfill: embeds every item and note that predates
 * migration 0020. New saves embed themselves; this catches up the past.
 *
 * Runs against whatever .env.local points at, with the service key (RLS
 * bypassed — it must see every user's rows to backfill them):
 *
 *   npx tsx scripts/backfill-embeddings.mts
 *
 * Safe to re-run: only rows with a null embedding are touched, and a failed
 * embed leaves the row for the next run. Rows without embeddings are still
 * served by the word-matching layer, so there is no deadline on this.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { embeddableText, embedText } from "../src/lib/ai/embeddings";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey || !process.env.GEMINI_API_KEY) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and GEMINI_API_KEY.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

let embedded = 0;
let skipped = 0;

async function backfill(
  table: "items" | "notes",
  columns: string,
  textOf: (row: Record<string, unknown>) => string,
) {
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .is("embedding", null)
    .limit(500);
  if (error) throw new Error(`${table}: ${error.message}`);

  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const text = textOf(row);
    if (!text) {
      skipped += 1;
      continue;
    }
    const embedding = await embedText(text, "RETRIEVAL_DOCUMENT");
    if (!embedding) {
      skipped += 1;
      continue;
    }
    const { error: updateError } = await supabase
      .from(table)
      .update({ embedding: JSON.stringify(embedding) })
      .eq("id", row.id as string);
    if (updateError) throw new Error(`${table} update: ${updateError.message}`);
    embedded += 1;
    // Free-tier embedding quota is generous but not infinite; be a good guest.
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

await backfill("items", "id, title, summary, attributes", (row) =>
  embeddableText([
    row.title as string,
    row.summary as string | null,
    row.attributes && typeof row.attributes === "object"
      ? Object.entries(row.attributes as Record<string, unknown>)
          .map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`)
          .join("\n")
      : null,
  ]),
);
await backfill("notes", "id, title, content", (row) =>
  embeddableText([row.title as string | null, row.content as string]),
);

console.log(`Embedded ${embedded}, skipped ${skipped}.`);
