"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { Pin, PinOff, Search, X } from "lucide-react";
import { toast } from "sonner";
import { setNotePinned } from "@/app/(app)/actions";
import type { NoteType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EmptySearch } from "@/components/kit/empty";
import { DeleteRecordButton } from "@/components/delete-record-button";

interface Note {
  id: string;
  title: string | null;
  content: string;
  note_type: NoteType;
  pinned: boolean;
  created_at: string;
}

const TYPE_LABELS: Record<NoteType, string> = {
  general: "General",
  idea: "Idea",
  memory: "Memory",
  place: "Place",
  gift_idea: "Gift idea",
};

const ALL = "__all__";

export function NotesBoard({ notes }: { notes: Note[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>(ALL);

  const availableTypes = useMemo(
    () => [...new Set(notes.map((note) => note.note_type))],
    [notes],
  );

  const filtered = notes.filter((note) => {
    if (typeFilter !== ALL && note.note_type !== typeFilter) return false;
    if (!query) return true;
    return `${note.title ?? ""} ${note.content}`.toLowerCase().includes(query.toLowerCase());
  });

  async function togglePin(note: Note) {
    const result = await setNotePinned(note.id, !note.pinned);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-3.5 top-1/2 size-4.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <label htmlFor="notes-search" className="sr-only">
          Search notes
        </label>
        <input
          id="notes-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search notes…"
          className="h-12 w-full rounded-lg bg-card ps-11 pe-11 text-base shadow-card outline-none placeholder:text-muted-foreground/70 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute end-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-secondary"
          >
            <X className="size-4.5" aria-hidden />
          </button>
        )}
      </div>

      {availableTypes.length > 1 && (
        <div className="rail -mx-4 gap-2 px-4 py-0.5" role="group" aria-label="Filter by kind">
          {[{ value: ALL, label: "All" }, ...availableTypes.map((t) => ({ value: t, label: TYPE_LABELS[t] }))].map(
            (filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setTypeFilter(filter.value)}
                aria-pressed={typeFilter === filter.value}
                className={cn(
                  "flex h-9 items-center rounded-full px-4 text-base font-medium transition-colors duration-150",
                  typeFilter === filter.value
                    ? "bg-foreground text-background"
                    : "bg-card text-muted-foreground shadow-card active:bg-secondary",
                )}
              >
                {filter.label}
              </button>
            ),
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptySearch query={query.trim() || TYPE_LABELS[typeFilter as NoteType]} />
      ) : (
        /* One column, always. A masonry grid on a phone produces a ragged
           bottom edge and unpredictable reading order for very little gain. */
        <ul className="flex flex-col gap-3">
          {filtered.map((note) => (
            <li key={note.id}>
              <article
                className={cn(
                  "flex flex-col gap-2 rounded-lg bg-card p-4 shadow-card",
                  // Pinned notes get a warm edge rather than a full border, so
                  // the distinction is visible without adding a second style.
                  note.pinned && "ring-1 ring-cat-note/30",
                )}
              >
                <div className="flex items-start gap-2">
                  <span className="rounded-full bg-cat-note/10 px-2.5 py-1 text-2xs font-medium uppercase tracking-wide text-cat-note">
                    {TYPE_LABELS[note.note_type]}
                  </span>
                  <span className="ms-auto flex shrink-0 items-center">
                    <button
                      type="button"
                      onClick={() => void togglePin(note)}
                      aria-label={note.pinned ? "Unpin note" : "Pin note"}
                      aria-pressed={note.pinned}
                      className="flex size-9 items-center justify-center rounded-full transition-colors active:bg-secondary"
                    >
                      {note.pinned ? (
                        <Pin className="size-4.5 text-cat-note" aria-hidden />
                      ) : (
                        <PinOff className="size-4.5 text-muted-foreground/60" aria-hidden />
                      )}
                    </button>
                    <DeleteRecordButton
                      table="notes"
                      id={note.id}
                      label={note.title ? `“${note.title}”` : "this note"}
                    />
                  </span>
                </div>

                {note.title && <h3 className="font-sans font-semibold">{note.title}</h3>}
                <p className="whitespace-pre-wrap text-base">{note.content}</p>
                <time
                  dateTime={note.created_at}
                  className="text-xs text-muted-foreground/80"
                >
                  {formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}
                </time>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
