import type { Metadata } from "next";
import { StickyNote } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { NoteRow } from "@/lib/types";
import { Screen, ScreenHeader } from "@/components/kit/screen";
import { CategoryRail } from "@/components/kit/category-rail";
import { Empty } from "@/components/kit/empty";
import { NotesBoard } from "./notes-board";

export const metadata: Metadata = { title: "Notes" };

export default async function NotesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notes")
    .select("id, title, content, note_type, pinned, created_at")
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  const notes = (data ?? []) as Pick<
    NoteRow,
    "id" | "title" | "content" | "note_type" | "pinned" | "created_at"
  >[];

  return (
    <Screen>
      <ScreenHeader title="Notes" description="Everything you didn't want to forget." />
      <CategoryRail />

      {notes.length === 0 ? (
        <Empty
          icon={StickyNote}
          title="No notes yet"
          description="Drop anything into capture — “gift idea for Dana: vinyl records.”"
        />
      ) : (
        <NotesBoard notes={notes} />
      )}
    </Screen>
  );
}
