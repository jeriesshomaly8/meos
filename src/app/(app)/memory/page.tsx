import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { formatEventDate } from "@/lib/dates";
import { CATEGORY_META, type ExtractionCategory } from "@/lib/categories";
import type {
  DocumentRow,
  FoodPreferenceRow,
  ImportantDateRow,
  NoteRow,
  PersonRow,
  RecipeRow,
} from "@/lib/types";
import { Screen, ScreenHeader } from "@/components/kit/screen";
import { CategoryRail } from "@/components/kit/category-rail";
import { MemoryBrowser, type MemoryItem } from "@/components/memory/memory-browser";

export const metadata: Metadata = { title: "Memory" };

/**
 * Everything is loaded once and filtered in the browser rather than
 * round-tripping per keystroke: a personal memory holds hundreds of rows,
 * not millions, and instant filtering is worth more than pagination here.
 * `PER_TABLE_LIMIT` is the guard rail — if a user ever exceeds it, the
 * banner below tells them rather than silently truncating.
 */
const PER_TABLE_LIMIT = 300;

const FOOD_LABEL: Record<FoodPreferenceRow["preference_type"], string> = {
  like: "Likes",
  dislike: "Dislikes",
  allergy: "Allergic to",
  dietary_restriction: "Dietary",
};

export default async function MemoryPage() {
  const supabase = await createClient();

  /*
   * `items` is read alongside the seven legacy tables because Memory says it
   * holds everything. It didn't: tasks, lists and alarms have lived in the
   * universal table since Phase 3 and none of them appeared here — the same
   * blind spot Phase 6 found in Ask, still live in this read path.
   */
  const [people, dates, food, recipes, documents, notes, actionables] = await Promise.all([
    supabase
      .from("people")
      .select("id, name, relationship, created_at")
      .order("created_at", { ascending: false })
      .limit(PER_TABLE_LIMIT),
    supabase
      .from("important_dates")
      .select("id, title, event_date, year_known, created_at")
      .order("created_at", { ascending: false })
      .limit(PER_TABLE_LIMIT),
    supabase
      .from("food_preferences")
      .select("id, food_name, preference_type, person_id, created_at, people(name)")
      .order("created_at", { ascending: false })
      .limit(PER_TABLE_LIMIT),
    supabase
      .from("recipes")
      .select("id, name, description, created_at")
      .order("created_at", { ascending: false })
      .limit(PER_TABLE_LIMIT),
    supabase
      .from("documents")
      .select("id, display_name, document_type, created_at")
      .order("created_at", { ascending: false })
      .limit(PER_TABLE_LIMIT),
    supabase
      .from("notes")
      .select("id, title, content, note_type, created_at")
      .order("created_at", { ascending: false })
      .limit(PER_TABLE_LIMIT),
    supabase
      .from("items")
      .select("id, capability, type_key, title, summary, status, created_at")
      // `record` is what a custom type stores as. Leaving it out would let a
      // user approve a type into existence and then never see it again.
      .in("capability", ["task", "list", "alarm", "record"])
      .order("created_at", { ascending: false })
      .limit(PER_TABLE_LIMIT),
  ]);

  const truncated = [people, dates, food, recipes, documents, notes, actionables].some(
    (result) => (result.data?.length ?? 0) >= PER_TABLE_LIMIT,
  );

  const items: MemoryItem[] = [
    ...((people.data ?? []) as Pick<
      PersonRow,
      "id" | "name" | "relationship" | "created_at"
    >[]).map((row) => ({
      id: `person-${row.id}`,
      category: "person" as ExtractionCategory,
      title: row.name,
      subtitle: row.relationship ?? "",
      href: `/people/${row.id}`,
      createdAt: row.created_at,
    })),

    ...((dates.data ?? []) as Pick<
      ImportantDateRow,
      "id" | "title" | "event_date" | "year_known" | "created_at"
    >[]).map((row) => ({
      id: `date-${row.id}`,
      category: "important_date" as ExtractionCategory,
      title: row.title,
      subtitle: formatEventDate(row.event_date, row.year_known),
      href: "/dates",
      createdAt: row.created_at,
    })),

    ...((food.data ?? []) as unknown as (Pick<
      FoodPreferenceRow,
      "id" | "food_name" | "preference_type" | "person_id" | "created_at"
    > & { people: { name: string } | null })[]).map((row) => ({
      id: `food-${row.id}`,
      category: "food_preference" as ExtractionCategory,
      title: row.food_name,
      subtitle: `${row.people?.name ?? "You"} · ${FOOD_LABEL[row.preference_type]}`,
      href: "/food",
      createdAt: row.created_at,
    })),

    ...((recipes.data ?? []) as Pick<
      RecipeRow,
      "id" | "name" | "description" | "created_at"
    >[]).map((row) => ({
      id: `recipe-${row.id}`,
      category: "recipe" as ExtractionCategory,
      title: row.name,
      subtitle: row.description ?? "",
      href: `/recipes/${row.id}`,
      createdAt: row.created_at,
    })),

    ...((documents.data ?? []) as Pick<
      DocumentRow,
      "id" | "display_name" | "document_type" | "created_at"
    >[]).map((row) => ({
      id: `document-${row.id}`,
      category: "document" as ExtractionCategory,
      title: row.display_name,
      subtitle: row.document_type,
      href: "/documents",
      createdAt: row.created_at,
    })),

    ...((notes.data ?? []) as Pick<
      NoteRow,
      "id" | "title" | "content" | "note_type" | "created_at"
    >[]).map((row) => ({
      id: `note-${row.id}`,
      category: "note" as ExtractionCategory,
      title: row.title ?? row.content.slice(0, 70),
      // With no title the title *is* the content, so a subtitle would repeat it.
      subtitle: row.title ? row.content.slice(0, 70) : "",
      href: "/notes",
      createdAt: row.created_at,
    })),

    ...((actionables.data ?? []) as {
      id: string;
      capability: "task" | "list" | "alarm" | "record";
      type_key: string;
      title: string;
      summary: string | null;
      status: string;
      created_at: string;
    }[]).map((row) => {
      /*
       * A `record` is whatever custom type the user approved, so it has no
       * fixed category — `custom` carries the neutral metadata and the type's
       * own key is what the subtitle says, since "New type" would tell the
       * user nothing they didn't already know.
       */
      const category: ExtractionCategory = row.capability === "record" ? "custom" : row.capability;
      const kindLabel =
        row.capability === "record"
          ? row.type_key.replace(/_/g, " ")
          : CATEGORY_META[category].label;
      return {
        id: `item-${row.id}`,
        category,
        title: row.title,
        // A done task still says what it was; the state is what changed, and
        // hiding it would make a ticked-off task look like it went missing.
        subtitle:
          row.status === "done"
            ? `Done${row.summary ? ` · ${row.summary}` : ""}`
            : (row.summary ?? kindLabel),
        // A record goes to its own type's screen; the shared "custom" metadata
        // points at Memory, which would be a link back to where you are.
        href: row.capability === "record" ? `/types/${row.type_key}` : CATEGORY_META[category].href,
        createdAt: row.created_at,
      };
    }),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <Screen>
      <ScreenHeader
        title="Memory"
        description="Everything MeOS is holding for you, newest first."
      />
      <CategoryRail />
      <MemoryBrowser items={items} truncated={truncated} />
    </Screen>
  );
}
